import type { Execution, TaskPlan } from "./contracts.ts";
import type { Stored } from "./store.ts";

export const IDENTITY_ACTIVATED = "task.identity.activated";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function wellFormed(value: string) {
  for (let i = 0; i < value.length; i++) {
    const n = value.charCodeAt(i);
    if (n >= 0xd800 && n <= 0xdbff) {
      const low = value.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
    } else if (n >= 0xdc00 && n <= 0xdfff) return false;
  }
  return true;
}
/** Engine-independent journal checks. Never normalize/re-segment saved titles. */
export function validSavedTitle(value: string) {
  return (
    value.length > 0 &&
    wellFormed(value) &&
    Array.from(value).length <= 64 &&
    Buffer.byteLength(value) <= 256 &&
    !/[\x00-\x1f\x7f-\x9f]/.test(value)
  );
}
const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
function bounded(value: string, suffix = "") {
  let result = "",
    scalars = Array.from(suffix).length,
    bytes = Buffer.byteLength(suffix);
  for (const { segment } of segmenter.segment(value)) {
    const n = Array.from(segment).length,
      b = Buffer.byteLength(segment);
    if (scalars + n > 64 || bytes + b > 256) break;
    result += segment;
    scalars += n;
    bytes += b;
  }
  return result;
}
function normalized(value: string) {
  if (!wellFormed(value)) throw Error("INVALID_TITLE_UNICODE");
  const text = value
    .normalize("NFC")
    .replace(/[\p{White_Space}\x00-\x1f\x7f-\x9f]/gu, " ")
    .replace(/\p{Cf}/gu, (c) => (c === "\u200d" ? c : ""))
    .replace(/ +/g, " ")
    .trim();
  const result = bounded(text).trimEnd();
  return !uuid.test(result) &&
    Array.from(result).some(
      (c) =>
        !/[\p{White_Space}\p{M}\p{C}\p{Default_Ignorable_Code_Point}]/u.test(c),
    )
    ? result
    : "";
}
export function allocateTaskTitle(
  goal: string,
  candidate: string | null | undefined,
  reserved: (title: string) => boolean,
) {
  if (candidate != null && Buffer.byteLength(candidate) > 1024)
    throw Error("TITLE_CANDIDATE_TOO_LARGE");
  let sample = goal.slice(0, 4096);
  if (/[\uD800-\uDBFF]$/.test(sample)) sample = sample.slice(0, -1);
  const base =
    (candidate == null ? "" : normalized(candidate)) ||
    normalized(sample) ||
    "Task";
  for (let n = 0; Number.isSafeInteger(n); n++) {
    const suffix = n ? "_" + n : "";
    const title = (bounded(base, suffix) || "Task") + suffix;
    if (!reserved(title)) return title;
  }
  throw Error("TITLE_CAPACITY_EXHAUSTED");
}
export function nextExecutionRound(plan: TaskPlan) {
  if (plan.identity_version !== 1 || plan.execution_round_high_water == null)
    throw Error("TASK_IDENTITY_NOT_READY");
  const round = plan.execution_round_high_water + 1;
  if (!Number.isSafeInteger(round)) throw Error("EXECUTION_ROUND_EXHAUSTED");
  return round;
}

/** Disposable index installed only after an acknowledged commit, also rebuilt by replay. */
export class TaskIdentityIndex {
  activated = false;
  private plans = new Map<string, TaskPlan>();
  private executions = new Map<string, Execution>();
  private titles = new Map<string, string>();
  private order = new Map<string, string[]>();
  private ranks = new Map<string, number>();
  private assigned = new Map<string, number>();
  private rounds = new Map<string, Map<number, string>>();
  hasTitle(title: string) {
    return this.titles.has(title);
  }
  validate(records: Stored[], activate: boolean) {
    const plans = new Map(
      records
        .filter((r): r is TaskPlan => r.record_type === "TaskPlan")
        .map((p) => [p.id, p]),
    );
    const executions = records.filter(
      (r): r is Execution => r.record_type === "Execution",
    );
    const newCounts = new Map<string, number>(),
      additions = new Map<string, number>();
    const stagedTitles = new Set<string>(),
      stagedRounds = new Set<string>();
    for (const p of plans.values()) {
      const old = this.plans.get(p.id),
        count = this.order.get(p.id)?.length ?? 0;
      const has =
        p.title !== undefined ||
        p.identity_version !== undefined ||
        p.execution_round_high_water !== undefined;
      if (
        has &&
        (p.title === undefined ||
          !validSavedTitle(p.title) ||
          !Number.isSafeInteger(p.execution_round_high_water) ||
          p.execution_round_high_water! < 0)
      )
        throw Error("INVALID_TASK_IDENTITY");
      if (p.title !== undefined) {
        const owner = this.titles.get(p.title);
        if ((owner && owner !== p.id) || stagedTitles.has(p.title))
          throw Error("DUPLICATE_TASK_TITLE");
        stagedTitles.add(p.title);
      }
      if (old?.title !== undefined && p.title !== old.title)
        throw Error("TASK_TITLE_IMMUTABLE");
      if (!old) {
        if (
          has &&
          (p.identity_version !== 1 || p.execution_round_high_water !== 0)
        )
          throw Error("INVALID_NEW_TASK_IDENTITY");
        if (this.activated && !has) throw Error("TASK_IDENTITY_REQUIRED");
      } else if (old.identity_version === 1) {
        if (p.identity_version !== 1) throw Error("TASK_IDENTITY_IMMUTABLE");
      } else if (has) {
        if (
          old.execution_round_high_water !== undefined &&
          old.execution_round_high_water !== p.execution_round_high_water
        )
          throw Error("MIGRATION_RESERVATION_IMMUTABLE");
        if (p.execution_round_high_water !== count)
          throw Error("INVALID_MIGRATION_HIGH_WATER");
      }
    }
    for (const e of executions) {
      const old = this.executions.get(e.id),
        previous = this.plans.get(e.task_id),
        p = plans.get(e.task_id) ?? previous;
      if (!p) throw Error("EXECUTION_TASK_MISSING");
      if (
        old &&
        (e.task_id !== old.task_id ||
          (old.execution_round !== undefined &&
            e.execution_round !== old.execution_round))
      )
        throw Error("EXECUTION_IDENTITY_IMMUTABLE");
      if (e.execution_round !== undefined) {
        if (
          !Number.isSafeInteger(e.execution_round) ||
          e.execution_round < 1 ||
          e.execution_round > (p.execution_round_high_water ?? -1)
        )
          throw Error("INVALID_EXECUTION_ROUND");
        const key = e.task_id + ":" + e.execution_round;
        const owner = this.rounds.get(e.task_id)?.get(e.execution_round);
        if ((owner && owner !== e.id) || stagedRounds.has(key))
          throw Error("DUPLICATE_EXECUTION_ROUND");
        stagedRounds.add(key);
      }
      if (!old) {
        if (previous?.identity_version === 1) {
          if (
            e.execution_round !== nextExecutionRound(previous) ||
            !plans.has(e.task_id)
          )
            throw Error("EXECUTION_ROUND_ALLOCATION_REQUIRED");
          newCounts.set(e.task_id, (newCounts.get(e.task_id) ?? 0) + 1);
        } else if (
          this.activated ||
          e.execution_round !== undefined ||
          p.title !== undefined
        )
          throw Error("EXECUTION_BEFORE_IDENTITY_READY");
      } else if (
        old.execution_round === undefined &&
        e.execution_round !== undefined
      ) {
        if (
          previous?.identity_version === 1 ||
          e.execution_round !== this.ranks.get(e.id)
        )
          throw Error("INVALID_EXECUTION_BACKFILL");
        additions.set(e.task_id, (additions.get(e.task_id) ?? 0) + 1);
      } else if (this.activated && e.execution_round === undefined)
        throw Error("EXECUTION_ROUND_REQUIRED");
    }
    for (const p of plans.values()) {
      const old = this.plans.get(p.id);
      if (old?.identity_version === 1) {
        const count = newCounts.get(p.id) ?? 0;
        if (
          count > 1 ||
          p.execution_round_high_water !==
            old.execution_round_high_water! + count
        )
          throw Error("INVALID_EXECUTION_HIGH_WATER");
      } else if (
        p.identity_version === 1 &&
        (this.assigned.get(p.id) ?? 0) + (additions.get(p.id) ?? 0) !==
          p.execution_round_high_water
      )
        throw Error("INCOMPLETE_TASK_BACKFILL");
    }
    if (activate) {
      if (this.activated) throw Error("TASK_IDENTITY_ALREADY_ACTIVATED");
      for (const p of new Map([...this.plans, ...plans]).values()) {
        if (p.identity_version !== 1) throw Error("INCOMPLETE_TASK_BACKFILL");
      }
    }
  }
  install(records: Stored[], activate: boolean) {
    for (const r of records) {
      if (r.record_type === "TaskPlan") {
        this.plans.set(r.id, r);
        if (r.title !== undefined) this.titles.set(r.title, r.id);
      } else if (r.record_type === "Execution") {
        const old = this.executions.get(r.id);
        if (!old) {
          let ids = this.order.get(r.task_id);
          if (!ids) this.order.set(r.task_id, (ids = []));
          ids.push(r.id);
          this.ranks.set(r.id, ids.length);
        }
        if (
          old?.execution_round === undefined &&
          r.execution_round !== undefined
        ) {
          this.assigned.set(r.task_id, (this.assigned.get(r.task_id) ?? 0) + 1);
          let rounds = this.rounds.get(r.task_id);
          if (!rounds) this.rounds.set(r.task_id, (rounds = new Map()));
          rounds.set(r.execution_round, r.id);
        }
        this.executions.set(r.id, r);
      }
    }
    if (activate) this.activated = true;
  }
}
