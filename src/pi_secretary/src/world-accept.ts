import { isDeepStrictEqual } from "node:util";
import { Ajv2020 } from "ajv/dist/2020.js";
import type {
  WorldEntity,
  WorldAssertion,
  OperationLogRecord,
  Scope,
  Input,
  WorldGenesis,
} from "./contracts.ts";
import { Store, base, revise, type Stored } from "./store.ts";
import { stableID } from "./execution-utils.ts";
import { assertActiveSourceEvents } from "./attachment-form.ts";
import {
  predicate,
  normalize,
  validateWorldLabel,
  ENTITY_KINDS,
} from "./world-catalog.ts";
export type WorldEdit = {
  intent:
    | "CREATE_ENTITY"
    | "EDIT_ENTITY"
    | "RETIRE_ENTITY"
    | "ASSERT"
    | "CORRECT"
    | "RETRACT";
  local_ref?: string;
  subject?: string;
  entity_kind?: WorldEntity["kind"];
  display_name?: string;
  rename?: { from: string; to: string };
  aliases?: { add?: string[]; remove?: string[] };
  predicate?: string;
  topic?: string;
  value?: unknown;
  keywords?: string[];
  target_fact_id?: string;
  source_event_ids?: string[];
  valid_from?: string;
  valid_to?: string | null;
  fresh_until?: string | null;
  source_note?: string;
};
export type WorldBatch = { version: 1; batch_id: string; changes: WorldEdit[] };
export type WorldAuthority =
  | { kind: "MODEL"; scope: Scope; owner_epoch: number }
  | {
      kind: "OWNER";
      scope: Scope;
      event: OperationLogRecord;
      owner_epoch: number;
    }
  | { kind: "SEED"; owner_id: string; secretary_name: string }
  | {
      kind: "IMPORT";
      owner_id: string;
      secretary_name: string;
      entities: WorldEntity[];
      assertions: WorldAssertion[];
      genesis: WorldGenesis;
    };
export const roleID = (owner: string, role: "MASTER" | "SECRETARY") =>
  stableID("world-role:" + owner + ":" + role);
export function resolveWorldEntity(
  entities: WorldEntity[],
  selector: string,
  includeRetired = false,
) {
  if (!selector?.trim() || selector.length > 256)
    throw Error("INVALID_ENTITY_SELECTOR");
  const key = normalize(selector);
  const matches = entities.filter(
    (e) =>
      (includeRetired || !e.retired_at) &&
      (e.id === selector ||
        (key === "role:master" && e.role === "MASTER") ||
        (key === "role:secretary" && e.role === "SECRETARY") ||
        normalize(e.display_name) === key ||
        e.aliases.some((a) => normalize(a) === key)),
  );
  return matches.length === 1
    ? { status: "resolved" as const, entity: matches[0] }
    : {
        status: matches.length
          ? ("ambiguous" as const)
          : ("not_found" as const),
        candidates: matches.slice(0, 20),
        truncated: matches.length > 20,
      };
}
export function evidenceSource(
  store: Store,
  ids: string[],
  scope: Scope,
  ownerEvent?: OperationLogRecord,
) {
  if (!ids.length || ids.length > 20 || new Set(ids).size !== ids.length)
    throw Error("EVIDENCE_REQUIRED");
  assertActiveSourceEvents(
    store,
    ids.filter((id) => id !== ownerEvent?.event_id),
  );
  const events = ids.map((id) => {
    const e = id === ownerEvent?.event_id ? ownerEvent : store.eventById(id);
    if (!e || e.scope.session_id !== scope.session_id)
      throw Error("SOURCE_EVENT_MISMATCH");
    if (e.event_type === "input.accepted") {
      const input = store.read<Input>(e.payload);
      if (store.get<Input>("Input", input.id).state === "WITHDRAWN")
        throw Error("EVIDENCE_WITHDRAWN");
      if (input.producer !== "MASTER")
        throw Error("SOURCE_EVENT_NOT_STATEMENT");
    } else if (
      ![
        "execution.finished",
        "feedback.delivered",
        "world.owner_requested",
        "main.message",
      ].includes(e.event_type)
    )
      throw Error("SOURCE_EVENT_NOT_STATEMENT");
    return e;
  });
  const master = (e: OperationLogRecord) =>
    e.actor === "MASTER_UI" &&
    (e.event_type === "world.owner_requested" ||
      (e.event_type === "input.accepted" &&
        !store.read<Input>(e.payload).attachments?.length));
  const kind: WorldAssertion["source_kind"] = events.every(master)
    ? "MASTER"
    : events.every((e) =>
          ["execution.finished", "feedback.delivered"].includes(e.event_type),
        )
      ? "TASK_REPORT"
      : events.every((e) => e.actor === "PROGRAM")
        ? "OBSERVATION"
        : "MODEL_INFERENCE";
  return { kind, events };
}
/** Pure synchronous preparation, reused for preview and final admission. Call commit immediately afterwards. */
export function acceptWorldChange(
  store: Store,
  batch: WorldBatch,
  authority: WorldAuthority,
  at: string,
) {
  const entities = new Map(
    store.all<WorldEntity>("WorldEntity").map((e) => [e.id, e]),
  );
  const facts = new Map(
    store.all<WorldAssertion>("WorldAssertion").map((f) => [f.id, f]),
  );
  const mutations = new Map<string, Stored>();
  const set = (r: Stored) => {
    if (mutations.has(r.record_type + ":" + r.id))
      throw Error("DUPLICATE_WORLD_TARGET");
    mutations.set(r.record_type + ":" + r.id, r);
  };
  if (authority.kind === "SEED" || authority.kind === "IMPORT") {
    if (store.all("WorldGenesis").length)
      throw Error("WORLD_ALREADY_INITIALIZED");
    if (authority.kind === "IMPORT") {
      for (const e of authority.entities) {
        if (entities.has(e.id)) throw Error("WORLD_IMPORT_ID_CONFLICT");
        entities.set(e.id, e);
        set(e);
      }
      for (const f of authority.assertions) {
        if (
          facts.has(f.id) ||
          !entities.has(f.subject_id) ||
          (f.object_entity_id && !entities.has(f.object_entity_id))
        )
          throw Error("WORLD_IMPORT_REFERENCE");
        facts.set(f.id, f);
        set(f);
      }
    }
    for (const role of ["MASTER", "SECRETARY"] as const) {
      const key = roleID(authority.owner_id, role);
      if (
        entities.has(key) ||
        [...entities.values()].some((e) => e.role === role)
      )
        throw Error("WORLD_ROLE_CONFLICT");
      const e: WorldEntity = {
        ...base(key),
        updated_at: at,
        schema_version: 1,
        record_type: "WorldEntity",
        kind: role === "MASTER" ? "PERSON" : "SERVICE",
        display_name: validateWorldLabel(
          role === "MASTER"
            ? "Master"
            : authority.secretary_name.trim() || "Secretary",
        ),
        aliases: [],
        role,
        external_key: "core-owner:" + authority.owner_id + ":" + role,
        retired_at: null,
      };
      entities.set(key, e);
      set(e);
    }
    for (const e of entities.values()) {
      validateWorldLabel(e.display_name);
      e.aliases.forEach(validateWorldLabel);
    }
    if (authority.kind === "IMPORT") set(authority.genesis);
    return {
      records: [...mutations.values()],
      result_ids: [...mutations.values()].map((r) => r.id),
      conflicts: [] as unknown[],
    };
  }
  if (authority.owner_epoch !== store.epoch) throw Error("STALE_OWNER");
  if (!store.all("WorldGenesis").length)
    throw Error("WORLD_LEGACY_IMPORT_PENDING");
  if (
    batch.version !== 1 ||
    !Array.isArray(batch.changes) ||
    batch.changes.length < 1 ||
    batch.changes.length > 20
  )
    throw Error("INVALID_WORLD_BATCH");
  const local = new Map<string, string>();
  const resolve = (selector?: string) => {
    if (!selector) throw Error("ENTITY_SELECTOR_REQUIRED");
    const r = resolveWorldEntity(
      [...entities.values()],
      local.get(selector) ?? selector,
    );
    if (r.status !== "resolved")
      throw Error(
        "ENTITY_" + r.status.toUpperCase() + ": " + JSON.stringify(r),
      );
    return r.entity;
  };
  const results: string[] = [];
  for (const [i, c] of batch.changes.entries()) {
    if (
      ![
        "CREATE_ENTITY",
        "EDIT_ENTITY",
        "RETIRE_ENTITY",
        "ASSERT",
        "CORRECT",
        "RETRACT",
      ].includes(c.intent)
    )
      throw Error("INVALID_WORLD_INTENT");
    const ev =
      authority.kind === "OWNER"
        ? [authority.event.event_id]
        : (c.source_event_ids ?? []);
    const source = evidenceSource(
      store,
      ev,
      authority.scope,
      authority.kind === "OWNER" ? authority.event : undefined,
    );
    if (
      ["CREATE_ENTITY", "EDIT_ENTITY", "RETIRE_ENTITY"].includes(c.intent) &&
      source.kind !== "MASTER"
    )
      throw Error("ENTITY_MASTER_EVIDENCE_REQUIRED");
    const changeID = stableID(batch.batch_id + ":change:" + i);
    if (c.intent === "CREATE_ENTITY") {
      if (
        !c.entity_kind ||
        !ENTITY_KINDS.includes(c.entity_kind) ||
        !c.display_name
      )
        throw Error("INVALID_ENTITY");
      if (
        c.local_ref &&
        (local.has(c.local_ref) || !/^\$[a-zA-Z][\w-]{0,63}$/.test(c.local_ref))
      )
        throw Error("INVALID_LOCAL_REFERENCE");
      const key = stableID(changeID + ":entity");
      if (entities.has(key)) throw Error("WORLD_ENTITY_EXISTS");
      const aliases = (c.aliases?.add ?? []).map(validateWorldLabel);
      if (
        c.aliases?.remove?.length ||
        aliases.length > 32 ||
        new Set(aliases.map(normalize)).size !== aliases.length
      )
        throw Error("INVALID_ALIASES");
      const e: WorldEntity = {
        ...base(key),
        updated_at: at,
        schema_version: 1,
        record_type: "WorldEntity",
        kind: c.entity_kind,
        display_name: validateWorldLabel(c.display_name),
        aliases,
        role: null,
        external_key: null,
        retired_at: null,
      };
      entities.set(key, e);
      set(e);
      results.push(key);
      if (c.local_ref) local.set(c.local_ref, key);
      continue;
    }
    const subject = resolve(c.subject);
    if (c.intent === "EDIT_ENTITY" || c.intent === "RETIRE_ENTITY") {
      if (
        c.intent === "RETIRE_ENTITY" &&
        (subject.role ||
          [...facts.values()].some(
            (f) =>
              f.status === "LIVE" &&
              (f.subject_id === subject.id ||
                f.object_entity_id === subject.id),
          ))
      )
        throw Error("ENTITY_LIVE_REFERENCE_OR_ROLE");
      let name = subject.display_name;
      if (c.rename) {
        if (subject.role === "SECRETARY") throw Error("USE_ASSISTANT_PROFILE");
        validateWorldLabel(c.rename.from);
        validateWorldLabel(c.rename.to);
        if (name !== c.rename.from && name !== c.rename.to)
          throw Error("STALE_BASE");
        name = c.rename.to.trim();
      }
      const add = (c.aliases?.add ?? []).map(validateWorldLabel),
        remove = (c.aliases?.remove ?? []).map(validateWorldLabel);
      if (add.some((a) => remove.some((r) => normalize(r) === normalize(a))))
        throw Error("CONTRADICTORY_ALIAS_DELTA");
      const aliases = subject.aliases.filter(
        (a) => !remove.some((r) => normalize(r) === normalize(a)),
      );
      for (const a of add)
        if (!aliases.some((r) => normalize(r) === normalize(a)))
          aliases.push(a);
      if (aliases.length > 32) throw Error("TOO_MANY_ALIASES");
      const patch = {
        display_name: name,
        aliases,
        retired_at: c.intent === "RETIRE_ENTITY" ? at : subject.retired_at,
      };
      if (
        isDeepStrictEqual(patch, {
          display_name: subject.display_name,
          aliases: subject.aliases,
          retired_at: subject.retired_at,
        })
      ) {
        results.push(subject.id);
        continue;
      }
      const e = { ...revise(subject, patch), updated_at: at };
      entities.set(e.id, e);
      set(e);
      results.push(e.id);
      continue;
    }
    const pred = predicate(c.predicate ?? "");
    if (!pred) throw Error("UNKNOWN_PREDICATE");
    if (!pred.subject_kinds.includes(subject.kind))
      throw Error("INVALID_SUBJECT_KIND");
    const target = c.target_fact_id ? facts.get(c.target_fact_id) : undefined;
    if (
      c.intent !== "ASSERT" &&
      (!target ||
        target.status !== "LIVE" ||
        target.subject_id !== subject.id ||
        target.predicate_key !== pred.predicate_key)
    )
      throw Error("TARGET_FACT_MISMATCH");
    if (c.intent === "ASSERT" && c.target_fact_id)
      throw Error("ASSERT_CANNOT_REPLACE");
    if (target) {
      const changed = {
        ...revise(target, {
          status: c.intent === "RETRACT" ? "RETRACTED" : "SUPERSEDED",
        }),
        updated_at: at,
      };
      facts.set(target.id, changed);
      set(changed);
      results.push(target.id);
    }
    if (c.intent === "RETRACT") continue;
    if (pred.retired) throw Error("PREDICATE_RETIRED");
    if (
      pred.predicate_key === "entity.guideline" &&
      (!subject.role || source.kind !== "MASTER")
    )
      throw Error("GUIDELINE_ROLE_MASTER_REQUIRED");
    const topic = c.topic ?? target?.topic ?? "other";
    if (!pred.topics.includes(topic)) throw Error("INVALID_TOPIC");
    let object: string | null = null,
      value = c.value ?? null;
    if (pred.value_type === "ENTITY") {
      if (typeof c.value !== "string")
        throw Error("ENTITY_VALUE_SELECTOR_REQUIRED");
      object = resolve(c.value).id;
      value = null;
    } else if (
      !new Ajv2020({ strict: false }).validate(pred.value_schema, value)
    )
      throw Error("INVALID_FACT_VALUE");
    const from = c.valid_from ?? at,
      to = c.valid_to ?? null,
      fresh = c.fresh_until ?? null;
    if (
      !Number.isFinite(Date.parse(from)) ||
      (to &&
        (!Number.isFinite(Date.parse(to)) ||
          Date.parse(to) <= Date.parse(from))) ||
      (fresh && !Number.isFinite(Date.parse(fresh)))
    )
      throw Error("INVALID_WORLD_TIME");
    const keywords = (c.keywords ?? []).map((k) => k.trim());
    if (keywords.length > 20 || keywords.some((k) => !k || k.length > 100))
      throw Error("INVALID_KEYWORDS");
    const f: WorldAssertion = {
      ...base(stableID(changeID + ":assertion")),
      updated_at: at,
      schema_version: 1,
      record_type: "WorldAssertion",
      subject_id: subject.id,
      predicate_key: pred.predicate_key,
      topic,
      value,
      object_entity_id: object,
      keywords,
      source_kind: source.kind,
      evidence_event_ids: ev,
      valid_from: from,
      valid_to: to,
      observed_at: source.events[0].occurred_at,
      fresh_until: fresh,
      note: c.source_note ?? null,
      status: "LIVE",
      replaces_id: target?.id ?? null,
      change_id: changeID,
    };
    facts.set(f.id, f);
    set(f);
    results.push(f.id);
  }
  return {
    records: [...mutations.values()],
    result_ids: results,
    conflicts: worldConflicts([...facts.values()], at).filter((group) =>
      group.fact_ids.some((id) => mutations.has("WorldAssertion:" + id)),
    ),
  };
}
function canonical(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
}
export function worldConflicts(facts: WorldAssertion[], asOf: string) {
  const groups = new Map<string, WorldAssertion[]>();
  for (const f of facts) {
    const p = predicate(f.predicate_key);
    if (
      f.status !== "LIVE" ||
      Date.parse(f.valid_from) > Date.parse(asOf) ||
      (f.valid_to && Date.parse(f.valid_to) <= Date.parse(asOf)) ||
      !p ||
      p.retired
    )
      continue;
    const key = JSON.stringify([
      f.subject_id,
      f.predicate_key,
      p.cardinality === "SINGLE" ? null : f.topic,
    ]);
    const group = groups.get(key) ?? [];
    group.push(f);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter(
      (g) =>
        g.length > 1 &&
        new Set(
          g.map((f) =>
            JSON.stringify([canonical(f.value), f.object_entity_id]),
          ),
        ).size > 1,
    )
    .filter(
      (g) =>
        predicate(g[0].predicate_key)!.cardinality === "SINGLE" ||
        g[0].topic !== "other",
    )
    .map((g) => ({
      status:
        predicate(g[0].predicate_key)!.cardinality === "SINGLE"
          ? "CONTESTED"
          : "POSSIBLY-CONFLICTING",
      fact_ids: g.map((f) => f.id),
    }));
}
