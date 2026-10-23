import { assertActiveSourceEvents } from "./attachment-form.ts";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { World } from "./world.ts";
import type {
  Input,
  OperationLogRecord,
  Scope,
  WorldChange,
  WorldCommand,
} from "./contracts.ts";
import { hash, id, now } from "./store.ts";
import { stableID } from "./scheduler.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function resolveEntity(world: World, selector: string) {
  if (!selector?.trim() || selector.length > 256)
    throw Error("INVALID_ENTITY_SELECTOR");
  const { rows } = await world.pool.query(
    `SELECT entity_id,display_name,kind,aliases FROM wm.entity
    WHERE retired_at IS NULL AND ${uuid.test(selector) ? "entity_id=$1::uuid" : "(lower(display_name)=lower($1) OR EXISTS(SELECT 1 FROM unnest(aliases) a WHERE lower(a)=lower($1)))"}
    ORDER BY display_name,entity_id LIMIT 21`,
    [selector],
  );
  return rows.length === 1
    ? { status: "resolved" as const, entity: rows[0] }
    : {
        status: rows.length ? ("ambiguous" as const) : ("not_found" as const),
        candidates: rows.slice(0, 20),
        truncated: rows.length > 20,
      };
}
export async function readWorld(
  world: World,
  options: {
    subject?: string | null;
    predicate?: string | null;
    cursor?: string | null;
    limit?: number;
  },
) {
  let subject: string | undefined;
  if (options.subject) {
    const resolved = await resolveEntity(world, options.subject);
    if (resolved.status !== "resolved") return resolved;
    subject = resolved.entity.entity_id;
  }
  if (
    options.predicate &&
    !(
      await world.pool.query(
        "SELECT 1 FROM wm.predicate WHERE predicate_key=$1",
        [options.predicate],
      )
    ).rowCount
  )
    return { status: "predicate_not_found", predicate: options.predicate };
  return {
    status: "ready",
    ...(await world.browse({
      subject,
      predicate: options.predicate ?? undefined,
      cursor: options.cursor ?? undefined,
      limit: options.limit ?? 20,
    })),
  };
}
export type ProposalIntent = {
  intent: "ASSERT" | "CORRECT" | "RETRACT";
  subject: string;
  predicate: string;
  value?: unknown;
  valid_from?: string;
  target_fact_id?: string;
  source_event_ids?: string[];
  source_note?: string;
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
function receipt(command: WorldCommand) {
  return {
    status:
      command.change.record_type === "WorldCatalogChange"
        ? "source_registration_required"
        : "proposed",
    command_id: command.id,
    operation_id: command.operation_id,
    state: command.state,
  };
}
export function recoveredWorldProposal(world: World, callID: string) {
  const prior = world.store
    .all<WorldCommand>("WorldCommand")
    .find(
      (c) =>
        c.change.change_id === stableID(callID + ":fact") ||
        c.change.change_id === stableID(callID + ":source"),
    );
  return prior ? receipt(prior) : undefined;
}
/** Resolve intent and source from authoritative events; authorization stays in World.propose. */
export async function proposeWorld(
  world: World,
  scope: Scope,
  args: ProposalIntent,
  callID: string,
  currentMasterEvents: string[],
) {
  const recovered = recoveredWorldProposal(world, callID);
  if (recovered) return recovered;
  if (!["ASSERT", "CORRECT", "RETRACT"].includes(args.intent))
    throw Error("INVALID_WORLD_INTENT");
  const resolved = await resolveEntity(world, args.subject);
  if (resolved.status !== "resolved") return resolved;
  const subject = resolved.entity.entity_id;
  const pred = (
    await world.pool.query(
      "SELECT * FROM wm.predicate WHERE predicate_key=$1",
      [args.predicate],
    )
  ).rows[0];
  if (!pred) throw Error("UNKNOWN_PREDICATE");
  if (!pred.subject_kinds.includes(resolved.entity.kind))
    throw Error("INVALID_SUBJECT_KIND");
  let target: Record<string, any> | undefined;
  if (args.intent !== "ASSERT") {
    if (!args.target_fact_id || !uuid.test(args.target_fact_id))
      throw Error("TARGET_FACT_REQUIRED");
    target = (
      await world.pool.query(
        `SELECT a.*,s.subject_id,s.predicate_key,s.scope_key,s.revision AS current_revision
      FROM wm.assertion a JOIN wm.fact_slot s USING(slot_id) JOIN wm.assertion_state st USING(assertion_id,slot_id)
      WHERE a.assertion_id=$1 AND st.status IN ('ACTIVE','SUPPORTING','CONTESTED')`,
        [args.target_fact_id],
      )
    ).rows[0];
    if (
      !target ||
      target.subject_id !== subject ||
      target.predicate_key !== args.predicate
    )
      throw Error("TARGET_FACT_MISMATCH");
  }
  let value = args.value,
    objectID: string | null = null;
  if (args.intent !== "RETRACT") {
    if (pred.value_type === "ENTITY") {
      if (typeof value !== "string")
        throw Error("ENTITY_VALUE_SELECTOR_REQUIRED");
      const object = await resolveEntity(world, value);
      if (object.status !== "resolved") return { ...object, field: "value" };
      objectID = object.entity.entity_id;
      value = null;
    } else if (
      !new Ajv2020({ strict: false }).validate(pred.value_schema, value)
    )
      throw Error("INVALID_FACT_VALUE");
  } else value = null;
  const eventIDs = args.source_event_ids?.length
    ? args.source_event_ids
    : currentMasterEvents.length === 1
      ? currentMasterEvents
      : [];
  if (!eventIDs.length) throw Error("EVIDENCE_REQUIRED");
  assertActiveSourceEvents(world.store, eventIDs);
  if (eventIDs.length > 20 || new Set(eventIDs).size !== eventIDs.length)
    throw Error("INVALID_SOURCE_EVENTS");
  const isMasterStatement = (event: OperationLogRecord) => {
    if (event.actor !== "MASTER_UI" || event.event_type !== "input.accepted")
      return false;
    const input = world.store.read<Input>(event.payload);
    return (
      input.record_type === "Input" &&
      input.producer === "MASTER" &&
      !input.attachments?.length &&
      world.store.get<Input>("Input", input.id).state !== "WITHDRAWN"
    );
  };
  const events = eventIDs.map((eventID) => {
    const event = world.store.logs.find((e) => e.event_id === eventID);
    if (!event || event.scope.session_id !== scope.session_id)
      throw Error("SOURCE_EVENT_MISMATCH");
    world.store.bytes(event.payload);
    const sourceInput =
      event.event_type === "input.accepted"
        ? world.store.read<Input>(event.payload)
        : undefined;
    if (
      sourceInput &&
      world.store.get<Input>("Input", sourceInput.id).state === "WITHDRAWN"
    )
      throw Error("ATTACHMENT_SOURCE_WITHDRAWN");
    if (
      event.actor === "MASTER_UI" &&
      !isMasterStatement(event) &&
      !(sourceInput?.producer === "MASTER" && sourceInput.attachments?.length)
    )
      throw Error("SOURCE_EVENT_NOT_STATEMENT");
    return event;
  });
  const sourceKind = events.every(isMasterStatement)
    ? "MASTER"
    : events.every((e) =>
          ["execution.finished", "feedback.delivered"].includes(e.event_type),
        )
      ? "TASK_REPORT"
      : events.every((e) => e.actor === "PROGRAM")
        ? "OBSERVATION"
        : "MODEL_INFERENCE";
  const sourceKey = "memory-tool:" + scope.session_id + ":" + sourceKind;
  const source = (
    await world.pool.query(
      "SELECT source_id FROM wm.source WHERE source_key=$1 AND kind=$2 AND retired_at IS NULL",
      [sourceKey, sourceKind],
    )
  ).rows[0];
  const evidence = events.map((e) => ({
    log_event_id: e.event_id,
    content: e.payload,
  }));
  const common = {
    schema_version: 1 as const,
    request_id: stableID(callID + ":request"),
    request_hash: "0".repeat(64),
  };
  if (!source) {
    const pending = world.store
      .all<WorldCommand>("WorldCommand")
      .find(
        (c) =>
          c.change.record_type === "WorldCatalogChange" &&
          c.change.kind === "REGISTER_SOURCE" &&
          c.change.source_key === sourceKey &&
          ["WAIT_AUTH", "READY", "APPLYING"].includes(c.state),
      );
    if (pending) return receipt(pending);
    return receipt(
      world.propose(
        {
          ...common,
          record_type: "WorldCatalogChange",
          change_id: stableID(callID + ":source"),
          kind: "REGISTER_SOURCE",
          entity_id: null,
          entity_kind: null,
          display_name: null,
          external_key: null,
          source_id: stableID(sourceKey),
          source_kind: sourceKind,
          source_key: sourceKey,
          description: "Historical memory evidence: " + sourceKind,
          expected_revision: 0,
          evidence,
        },
        scope,
      ),
    );
  }
  const scopeKey =
    target?.scope_key ??
    (pred.cardinality === "SINGLE" ? "" : hash(canonical(objectID ?? value)));
  const slot = (
    await world.pool.query(
      "SELECT revision FROM wm.fact_slot WHERE subject_id=$1 AND predicate_key=$2 AND scope_key=$3",
      [subject, args.predicate, scopeKey],
    )
  ).rows[0];
  const time = now();
  const change: WorldChange = {
    ...common,
    record_type: "WorldChange",
    change_id: stableID(callID + ":fact"),
    mode: args.intent,
    assertion_id: args.intent === "RETRACT" ? args.target_fact_id! : id(),
    subject_id: subject,
    predicate_key: args.predicate,
    scope_key: scopeKey,
    source_id: source.source_id,
    expected_revision: Number(target?.current_revision ?? slot?.revision ?? 0),
    value: value as WorldChange["value"],
    object_entity_id: objectID,
    replaces_assertion_id: target ? args.target_fact_id! : null,
    resolve_conflict_id: null,
    resolution_note: null,
    valid_from: args.valid_from ?? time,
    valid_to: null,
    fresh_until: null,
    provenance: {
      source_kind: sourceKind,
      source_id: source.source_id,
      evidence,
      observed_at: sourceKind === "OBSERVATION" ? events[0].occurred_at : null,
      received_at: time,
      scope: args.source_note?.trim() || "Historical conversation memory",
      epistemic:
        sourceKind === "OBSERVATION"
          ? "OBSERVED"
          : sourceKind === "MODEL_INFERENCE"
            ? "INFERRED"
            : "REPORTED",
    },
  };
  return receipt(world.propose(change, scope));
}
