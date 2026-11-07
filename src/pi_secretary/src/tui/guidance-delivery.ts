import { randomUUID } from "node:crypto";
import type {
  Execution,
  Guidance,
  Receipt,
  RequestStatus,
  TaskTargetResolution,
} from "../api/contracts.ts";
import type { DeliveryClient } from "./delivery.ts";
import type { LocalState, StatePersistence } from "./state.ts";
import { draftEmpty } from "./state.ts";
import { equalSnapshotContent, type DraftSnapshot } from "./draft.ts";
import { guideHeader, parseGuide, type GuideCommand } from "./guide-command.ts";
import {
  guidanceFingerprint,
  guidanceHash,
  sameGuidanceDraft,
  validateGuidance,
  type GuidanceEnvelope,
} from "./guidance-state.ts";

type Files = StatePersistence & {
  recoverGuidance(p: GuidanceEnvelope): Promise<string>;
};
const failure = (e: unknown) => (e instanceof Error ? e.message : String(e));
const ended = new Set([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "RESULT_UNKNOWN",
]);
// These admission failures occur after request replay and cannot become eligible later.
const definitive = new Set([
  "TARGET_ENDED",
  "TARGET_RESULT_UNKNOWN",
  "GUIDANCE_LIMIT_REACHED",
  "GUIDANCE_EMPTY",
  "GUIDANCE_TOO_LARGE",
]);
export const guidanceRoute = (
  c: Pick<GuideCommand, "title" | "round">,
  purpose = "guidance",
) =>
  `task-browser/resolve?selector_kind=title&selector=${encodeURIComponent(c.title)}&execution_round=${c.round}&purpose=${purpose}`;

/** Durable Task outbox. Startup/reconnect performs reads only; retries are explicit. */
export class GuidanceDelivery {
  client?: DeliveryClient;
  busy = false;
  hint = "";
  preview = "";
  onChange = () => {};
  knownGuidance: (execution: string) => Guidance[] | undefined = () =>
    undefined;
  private closed = false;
  private epoch = 0;
  private previewKey = "";
  private previewTimer?: ReturnType<typeof setTimeout>;
  private job?: Promise<void>;
  constructor(
    readonly state: LocalState,
    readonly files: Files,
  ) {}
  async connect(client: DeliveryClient) {
    const c = await client.core();
    if (
      c.data_domain_id !== this.state.domain ||
      c.mode !== this.state.mode ||
      c.instance_id !== client.endpoint.instance_id
    )
      throw Error("TUI_DOMAIN_MISMATCH");
    this.client = client;
    this.epoch++;
    this.previewKey = "";
  }
  disconnect() {
    this.client = undefined;
    this.epoch++;
    this.previewKey = "";
    this.preview = "";
    clearTimeout(this.previewTimer);
  }
  previewDraft(raw: string) {
    const h = guideHeader(raw),
      key = h ? JSON.stringify([h.title, h.round]) : "";
    if (key === this.previewKey) return;
    this.previewKey = key;
    clearTimeout(this.previewTimer);
    this.preview = "";
    if (!h || !this.client) return;
    const client = this.client,
      epoch = this.epoch;
    const valid = () =>
      !this.closed &&
      this.client === client &&
      epoch === this.epoch &&
      key === this.previewKey;
    this.previewTimer = setTimeout(() => {
      void client
        .query<TaskTargetResolution>(guidanceRoute(h), { timeoutMs: 2000 })
        .then((t) => {
          if (valid()) {
            this.preview = `${t.title} · #${t.execution_round} · ${t.state} · 仅本次执行`;
            this.onChange();
          }
        })
        .catch((e) => {
          if (valid()) {
            this.preview = `目标暂不可引导：${failure(e)}`;
            this.onChange();
          }
        });
    }, 180);
  }
  private valid(c: DeliveryClient, p: GuidanceEnvelope) {
    return (
      !this.closed && this.client === c && this.state.guidancePending === p
    );
  }
  private async save() {
    await this.files.save(this.state);
  }
  private matching(p: GuidanceEnvelope, receipt: Receipt) {
    if (
      receipt.request_id !== p.id ||
      receipt.command !== p.path ||
      receipt.acceptance !== "ACCEPTED" ||
      !["ACCEPTED", "COMPLETED"].includes(receipt.state) ||
      receipt.error_code ||
      receipt.resource_ids.filter((r) => r.type === "Guidance").length !== 1
    )
      throw Error("GUIDANCE_RECEIPT_MISMATCH");
    return receipt.resource_ids.find((r) => r.type === "Guidance")!.id;
  }
  private async verify(
    c: DeliveryClient,
    p: GuidanceEnvelope,
    receipt: Receipt,
  ) {
    const id = this.matching(p, receipt);
    if (!this.valid(c, p)) return;
    p.receipt = structuredClone(receipt);
    p.status = "ACCEPTED_VERIFICATION_PENDING";
    await this.save();
    if (!this.valid(c, p)) return;
    // A failed detail read leaves the accepted checkpoint intact and can never resend.
    const g = await c.query<Guidance>(`guidance/${encodeURIComponent(id)}`, {
      timeoutMs: 2000,
    });
    if (!this.valid(c, p)) return;
    if (
      g.id !== id ||
      g.source !== "MASTER" ||
      g.task_id !== p.body.task_id ||
      g.execution_id !== p.target.execution_id ||
      g.text !== p.body.text ||
      guidanceHash(g.text) !== p.sha256
    ) {
      p.status = "ACCEPTED_WITH_INTEGRITY_ERROR";
      p.error = "GUIDANCE_DETAIL_MISMATCH";
      await this.release(
        p,
        "Core 已接收，但详情不一致；证据已导出，禁止重发",
        true,
      );
      return;
    }
    p.guidance = g;
    p.status = "ACCEPTED";
    await this.save(); // Acceptance durable BEFORE clearing a matching draft.
    if (!this.valid(c, p)) return;
    const previous = this.state.drafts.Task;
    if (sameGuidanceDraft(p, previous))
      this.state.drafts.Task = { raw: "", generation: previous.generation + 1 };
    const cleared = this.state.drafts.Task;
    this.state.guidanceLast = structuredClone(p);
    delete this.state.guidancePending;
    try {
      await this.save();
    } catch (e) {
      this.state.guidancePending = p;
      if (this.state.drafts.Task === cleared) this.state.drafts.Task = previous;
      throw e;
    }
    this.hint = `SENT · ${p.target.title} #${p.target.execution_round} · ${g.id}；后续阶段以 Core 回执为准`;
  }
  private async release(p: GuidanceEnvelope, hint: string, accepted = false) {
    const previousStatus = p.status;
    const file = await this.files.recoverGuidance(p);
    if (this.state.guidancePending !== p) return;
    if (!accepted && p.status !== "CONFLICT") p.status = "NOT_ACCEPTED";
    this.state.guidanceRecovery = { id: p.id, file };
    this.state.guidanceLast = structuredClone(p);
    delete this.state.guidancePending;
    try {
      await this.save();
    } catch (e) {
      this.state.guidancePending = p;
      p.status = previousStatus;
      throw e;
    }
    this.hint = hint + " · " + file;
  }
  private async check(c: DeliveryClient, p: GuidanceEnvelope) {
    if (p.status === "ACCEPTED_WITH_INTEGRITY_ERROR") {
      await this.release(p, "已接收但详情不一致；已保留证据", true);
      return;
    }
    if (p.receipt) {
      await this.verify(c, p, p.receipt);
      return;
    }
    if (p.status === "CONFLICT") return;
    try {
      const r = await c.query<RequestStatus>(`requests/${p.id}`, {
        timeoutMs: 2000,
      });
      if (this.valid(c, p)) await this.verify(c, p, r.receipt);
    } catch (e) {
      if (!this.valid(c, p) || p.receipt) throw e;
      if (failure(e) !== "NOT_FOUND") throw e;
      // Order matters: terminal execution THEN negative request read, on one instance.
      const execution = await c.query<Execution>(
        `executions/${p.target.execution_id}`,
        { timeoutMs: 2000 },
      );
      if (!this.valid(c, p)) return;
      if (
        execution.id !== p.target.execution_id ||
        execution.task_id !== p.target.task_id
      )
        throw Error("GUIDANCE_EXECUTION_MISMATCH");
      if (ended.has(execution.state)) {
        try {
          const r = await c.query<RequestStatus>(`requests/${p.id}`, {
            timeoutMs: 2000,
          });
          if (this.valid(c, p)) await this.verify(c, p, r.receipt);
        } catch (e) {
          if (failure(e) !== "NOT_FOUND" || p.receipt) throw e;
          const core = await c.core();
          if (this.valid(c, p) && core.instance_id === c.endpoint.instance_id)
            await this.release(p, "原执行已结束且请求未接收；草稿保留");
        }
      } else if (!p.attempts.includes(c.endpoint.instance_id) && p.cursor) {
        await c.changes(p.cursor, 1);
        if (this.valid(c, p))
          await this.release(p, "已确认旧实例未接收；草稿保留");
      } else this.hint = "引导送达未确认；F6 查看或同 ID 重试，草稿保留";
    }
  }
  async reconcile(): Promise<void> {
    if (this.busy || this.closed) return;
    if (this.job) return this.job;
    const c = this.client,
      p = this.state.guidancePending;
    if (!c) return;
    if (!p) {
      const last = this.state.guidanceLast;
      if (!last?.guidance || last.status !== "ACCEPTED") return;
      this.job = c
        .query<Guidance>(`guidance/${last.guidance.id}`, { timeoutMs: 2000 })
        .then(async (g) => {
          if (
            this.closed ||
            this.client !== c ||
            this.state.guidanceLast !== last
          )
            return;
          if (
            g.id !== last.guidance!.id ||
            g.source !== "MASTER" ||
            g.task_id !== last.target.task_id ||
            g.execution_id !== last.target.execution_id ||
            guidanceHash(g.text) !== last.sha256
          )
            throw Error("GUIDANCE_DETAIL_MISMATCH");
          if (g.revision !== last.guidance!.revision) {
            last.guidance = g;
            await this.save();
          }
        })
        .catch((e) => {
          if (this.client === c)
            this.hint = `最新回执暂不可核验：${failure(e)}`;
        })
        .finally(() => {
          this.job = undefined;
          this.onChange();
        });
      await this.job;
      return;
    }
    this.job = this.check(c, p)
      .catch((e) => {
        if (this.valid(c, p))
          this.hint = `${p.status} · ${failure(e)}；原请求保留`;
      })
      .finally(() => {
        this.job = undefined;
        this.onChange();
      });
    await this.job;
  }
  async submit(raw: string, snapshot: DraftSnapshot, command: GuideCommand) {
    if (this.busy || this.closed) return;
    const c = this.client;
    if (!c) {
      this.hint = "Core 未连接；Task 草稿保留";
      this.onChange();
      return;
    }
    // Capture before the first await, including provenance and generation.
    const captured = structuredClone({
      raw,
      snapshot,
      generation: this.state.drafts.Task.generation,
    });
    this.busy = true;
    try {
      if (this.job) await this.job;
      let p = this.state.guidancePending;
      if (p) {
        const matches =
          p.raw === raw && equalSnapshotContent(p.snapshot, snapshot);
        await this.check(c, p);
        if (
          this.state.guidancePending !== p ||
          p.receipt ||
          p.status !== "UNKNOWN"
        )
          return;
        if (!matches) {
          this.hint = "原引导尚未解决；新 Task 草稿保留，Main 仍可使用";
          return;
        }
      } else {
        const last = this.state.guidanceLast;
        if (last?.receipt && sameGuidanceDraft(last, this.state.drafts.Task)) {
          this.hint = "此原始提交已被 Core 接收，禁止重新创建请求";
          return;
        }
        if (!parseGuide(raw) || parseGuide(raw)!.text !== command.text)
          throw Error("INVALID_GUIDANCE_COMMAND");
        const target = await c.query<TaskTargetResolution>(
          guidanceRoute(command),
        );
        if (
          target.title !== command.title ||
          target.execution_round !== command.round
        )
          throw Error("GUIDANCE_TARGET_MISMATCH");
        if (this.client !== c || this.closed)
          throw Error("CORE_CONNECTION_CHANGED");
        const known = this.knownGuidance(target.execution_id);
        if (
          known &&
          (known.length >= 64 ||
            known.reduce((n, g) => n + Buffer.byteLength(g.text), 0) +
              Buffer.byteLength(command.text) >
              65536)
        )
          throw Error("GUIDANCE_LIMIT_REACHED");
        this.hint = `提交到 ${target.title} #${target.execution_round} · ${target.state} · 仅本次执行`;
        this.onChange();
        const body = {
            request_id: randomUUID(),
            task_id: target.task_id,
            text: command.text,
          },
          path = `executions/${target.execution_id}/guidance`;
        p = {
          version: 1,
          id: body.request_id,
          domain: this.state.domain,
          mode: this.state.mode,
          path,
          target,
          body,
          sha256: guidanceHash(body.text),
          fingerprint: guidanceFingerprint(path, body),
          ...captured,
          created_at: new Date().toISOString(),
          attempts: [],
          status: "UNKNOWN",
        };
        validateGuidance(p, this.state.domain, this.state.mode);
        this.state.guidancePending = p;
      }
      if (!this.valid(c, p)) throw Error("CORE_CONNECTION_CHANGED");
      if (!p.attempts.includes(c.endpoint.instance_id))
        p.attempts.push(c.endpoint.instance_id);
      delete p.cursor;
      await this.save(); // Includes frozen envelope AND attempted instance before dispatch.
      if (!this.valid(c, p)) throw Error("CORE_CONNECTION_CHANGED");
      try {
        const post = c.command(p.path, { ...p.body });
        const pending = p;
        void c
          .syncCursor()
          .then(async (s) => {
            if (this.valid(c, pending)) {
              pending.cursor = s.cursor;
              await this.save();
            }
          })
          .catch(() => {});
        const receipt = await post;
        if (this.valid(c, p)) await this.verify(c, p, receipt);
      } catch (e) {
        if (!this.valid(c, p)) return;
        if (p.receipt) throw e;
        const code = failure(e);
        if (definitive.has(code))
          await this.release(p, `Core 明确拒绝：${code}；原文保留`);
        else {
          p.status = code === "REQUEST_CONFLICT" ? "CONFLICT" : "UNKNOWN";
          p.error = code;
          this.hint = `${p.status} · ${code}；F6 查看原请求`;
          await this.save();
        }
      }
    } catch (e) {
      this.hint = `引导未完成：${failure(e)}；原文保留`;
    } finally {
      this.busy = false;
      this.onChange();
    }
  }
  async retry() {
    const p = this.state.guidancePending;
    if (!p || this.busy) return;
    await this.submit(p.raw, p.snapshot, {
      title: p.target.title,
      round: p.target.execution_round,
      text: p.body.text,
    });
  }
  async restore() {
    const p = this.state.guidancePending ?? this.state.guidanceLast;
    if (!p || !draftEmpty(this.state.drafts.Task)) {
      this.hint = "Task 草稿非空；请使用复制原文";
      this.onChange();
      return;
    }
    const old = this.state.drafts.Task;
    this.state.drafts.Task = {
      raw: p.raw,
      snapshot: structuredClone(p.snapshot),
      generation: old.generation + 1,
      binding: p.id,
    };
    const restored = this.state.drafts.Task;
    try {
      await this.save();
    } catch (e) {
      if (this.state.drafts.Task === restored) this.state.drafts.Task = old;
      throw e;
    }
    this.onChange();
  }
  async exportConflict() {
    if (this.busy || this.state.guidancePending?.status !== "CONFLICT") return;
    this.busy = true;
    try {
      await this.release(
        this.state.guidancePending,
        "冲突原文已导出；可修改后明确提交",
      );
    } finally {
      this.busy = false;
      this.onChange();
    }
  }
  close() {
    this.closed = true;
    this.disconnect();
  }
}
