import { isDeepStrictEqual } from "node:util";
import type { Store, Stored } from "./store.ts";
import type {
  JournalTransaction,
  WorldEntity,
  WorldAssertion,
  CoreIdentity,
  AssistantProfile,
  Operation,
  AuthorizationRequest,
} from "./contracts.ts";
import { roleID, acceptWorldChange, type WorldBatch } from "./world-accept.ts";
import { validateWorldLabel } from "./world-catalog.ts";
/** Runs on live commit and historical replay; legacy record decoding is deliberately retained. */
export function validateWorldFrame(
  store: Store,
  txn: JournalTransaction,
  staged: Stored[],
) {
  const relevant = staged.some(
    (r) =>
      r.record_type.startsWith("World") ||
      r.record_type === "AssistantProfile" ||
      (r.record_type === "Operation" &&
        r.state === "SUCCEEDED" &&
        store.find<Operation>("Operation", r.id)?.state === "AUTHORIZED"),
  );
  if (!relevant) return;
  const candidate = new Map(staged.map((r) => [r.record_type + ":" + r.id, r]));
  const get = (type: Stored["record_type"], id: string) =>
    candidate.get(type + ":" + id) ?? store.find(type, id);
  const entities = [
    ...store
      .all<WorldEntity>("WorldEntity")
      .filter((e) => !candidate.has("WorldEntity:" + e.id)),
    ...staged.filter((e): e is WorldEntity => e.record_type === "WorldEntity"),
  ];
  const worldMutations = staged.filter(
    (r) =>
      r.record_type === "WorldEntity" || r.record_type === "WorldAssertion",
  );
  const applying = staged.filter(
    (r): r is Operation =>
      r.record_type === "Operation" &&
      r.state === "SUCCEEDED" &&
      store.find<Operation>("Operation", r.id)?.state === "AUTHORIZED",
  );
  if (
    txn.log_records.some((e) => e.event_type === "operation.journal_applied") &&
    applying.length !== 1
  )
    throw Error("WORLD_APPLY_BUNDLE_REQUIRED");
  const genesis = staged.find((r) => r.record_type === "WorldGenesis");
  const ownerEvent = txn.log_records.find(
    (e) => e.event_type === "world.owner_requested",
  );
  if (genesis?.record_type === "WorldGenesis") {
    if (
      store.all("WorldGenesis").length ||
      store.all("WorldEntity").length ||
      store.all("WorldAssertion").length ||
      genesis.revision !== 1 ||
      genesis.entity_count !== entities.length ||
      genesis.assertion_count !==
        staged.filter((r) => r.record_type === "WorldAssertion").length ||
      !txn.log_records.some(
        (e) =>
          e.event_type === "world.genesis" &&
          isDeepStrictEqual(store.read(e.payload), genesis),
      )
    )
      throw Error("WORLD_GENESIS_NOT_ATOMIC");
    for (const role of ["MASTER", "SECRETARY"])
      if (entities.filter((e) => e.role === role).length !== 1)
        throw Error("WORLD_GENESIS_ROLE_MISSING");
  } else if (
    worldMutations.length &&
    !txn.log_records.some((e) => e.event_type === "operation.journal_applied")
  ) {
    const profileChange = staged.find(
      (r) => r.record_type === "AssistantProfile",
    );
    if (profileChange) {
      if (
        worldMutations.length !== 1 ||
        worldMutations[0].record_type !== "WorldEntity" ||
        worldMutations[0].role !== "SECRETARY"
      )
        throw Error("WORLD_PROFILE_EXTRA_MUTATION");
      const previous = store.find<WorldEntity>(
        "WorldEntity",
        worldMutations[0].id,
      );
      if (
        !previous ||
        !isDeepStrictEqual(previous.aliases, worldMutations[0].aliases)
      )
        throw Error("WORLD_PROFILE_EXTRA_MUTATION");
    } else if (ownerEvent) {
      if (ownerEvent.actor !== "MASTER_UI")
        throw Error("WORLD_OWNER_EVIDENCE_REQUIRED");
      const expected = acceptWorldChange(
        store,
        store.read<WorldBatch>(ownerEvent.payload),
        {
          kind: "OWNER",
          scope: ownerEvent.scope,
          event: ownerEvent,
          owner_epoch: store.epoch,
        },
        worldMutations[0].updated_at,
      );
      if (!isDeepStrictEqual(expected.records, worldMutations))
        throw Error("WORLD_OWNER_MUTATIONS_MISMATCH");
    } else throw Error("WORLD_ACCEPTOR_REQUIRED");
  }
  const owner = store.all<CoreIdentity>("CoreIdentity")[0];
  for (const role of ["MASTER", "SECRETARY"] as const)
    if (entities.filter((e) => e.role === role).length > 1)
      throw Error("DUPLICATE_WORLD_ROLE");
  for (const r of staged) {
    if (r.record_type === "WorldGenesis" && store.find("WorldGenesis", r.id))
      throw Error("WORLD_GENESIS_IMMUTABLE");
    if (r.record_type === "WorldEntity") {
      validateWorldLabel(r.display_name);
      r.aliases.forEach(validateWorldLabel);
      const old = store.find<WorldEntity>("WorldEntity", r.id);
      if (
        old &&
        ["kind", "role", "external_key"].some(
          (k) => !isDeepStrictEqual((old as any)[k], (r as any)[k]),
        )
      )
        throw Error("WORLD_ENTITY_IDENTITY_IMMUTABLE");
      if (
        r.role &&
        (!owner ||
          r.id !== roleID(owner.owner_id, r.role) ||
          r.kind !== (r.role === "MASTER" ? "PERSON" : "SERVICE") ||
          r.external_key !== "core-owner:" + owner.owner_id + ":" + r.role ||
          r.retired_at)
      )
        throw Error("WORLD_ROLE_PROTECTED");
      if (r.role === "SECRETARY") {
        const p =
          staged.find(
            (x): x is AssistantProfile => x.record_type === "AssistantProfile",
          ) ?? store.all<AssistantProfile>("AssistantProfile")[0];
        if (!p || r.display_name !== (p.name.trim() || "Secretary"))
          throw Error("SECRETARY_PROFILE_NOT_ATOMIC");
      }
    }
    if (
      r.record_type === "AssistantProfile" &&
      store.all("WorldGenesis").length
    ) {
      if (r.name.trim()) validateWorldLabel(r.name);
      const e = entities.find((e) => e.role === "SECRETARY");
      if (!e || e.display_name !== (r.name.trim() || "Secretary"))
        throw Error("SECRETARY_PROFILE_NOT_ATOMIC");
    }
    if (r.record_type === "WorldAssertion") {
      const old = store.find<WorldAssertion>("WorldAssertion", r.id);
      if (old) {
        const strip = ({
          revision,
          updated_at,
          status,
          ...body
        }: WorldAssertion) => body;
        if (
          old.status !== "LIVE" ||
          !["SUPERSEDED", "RETRACTED"].includes(r.status) ||
          !isDeepStrictEqual(strip(old), strip(r))
        )
          throw Error("WORLD_ASSERTION_IMMUTABLE");
      }
      if (
        !get("WorldEntity", r.subject_id) ||
        (r.object_entity_id && !get("WorldEntity", r.object_entity_id))
      )
        throw Error("WORLD_ENTITY_REFERENCE_MISSING");
      for (const id of r.evidence_event_ids)
        if (
          !store.eventById(id) &&
          !txn.log_records.some((e) => e.event_id === id)
        )
          throw Error("WORLD_EVIDENCE_REFERENCE_MISSING");
    }
    if (r.record_type !== "Operation") continue;
    const old = store.find<Operation>("Operation", r.id);
    if (old?.state !== "AUTHORIZED" || r.state !== "SUCCEEDED") continue;
    // Scope import remains closed until #113 supplies its exact frame validator.
    if (r.action.action !== "world.change")
      throw Error("JOURNAL_APPLY_ACTION_FORBIDDEN");
    if (old.owner_epoch !== txn.owner_epoch) throw Error("STALE_OWNER");
    const a = old.authorization_id
      ? store.find<AuthorizationRequest>(
          "AuthorizationRequest",
          old.authorization_id,
        )
      : undefined;
    const consumed = a
      ? candidate.get("AuthorizationRequest:" + a.id)
      : undefined;
    if (
      !a ||
      a.state !== "APPROVED" ||
      consumed?.record_type !== "AuthorizationRequest" ||
      consumed.state !== "CONSUMED" ||
      !consumed.consumed_at ||
      !isDeepStrictEqual(a.action, old.action) ||
      !isDeepStrictEqual(old.action, r.action) ||
      r.effect !== "APPLIED" ||
      !r.receipt ||
      r.rule_id ||
      r.authorization_id !== old.authorization_id ||
      !isDeepStrictEqual(r.scope, old.scope) ||
      consumed.operation_id !== old.id ||
      !isDeepStrictEqual(consumed.action, a.action) ||
      !isDeepStrictEqual(consumed.scope, a.scope) ||
      consumed.decided_by !== a.decided_by ||
      consumed.decision_id !== a.decision_id ||
      !isDeepStrictEqual(a.scope, old.scope) ||
      (a.expires_at && Date.parse(a.expires_at) <= Date.parse(txn.committed_at))
    )
      throw Error("WORLD_GRANT_NOT_ATOMIC");
    if (
      staged.length !== worldMutations.length + 2 ||
      staged.some(
        (x) =>
          ![
            "WorldEntity",
            "WorldAssertion",
            "AuthorizationRequest",
            "Operation",
          ].includes(x.record_type),
      ) ||
      applying.length !== 1
    )
      throw Error("WORLD_FRAME_UNEXPECTED_MUTATION");
    const receipt = store.read<any>(r.receipt);
    if (
      !txn.log_records.some(
        (e) =>
          e.event_type === "operation.journal_applied" &&
          isDeepStrictEqual(store.read(e.payload), r),
      ) ||
      !txn.log_records.some(
        (e) =>
          e.event_type === "world.changed" &&
          isDeepStrictEqual(store.read(e.payload), receipt),
      )
    )
      throw Error("WORLD_RESULT_NOT_ATOMIC");
    // Replay validates against the frame's owner epoch, without modifying live ownership.
    const oldEpoch = store.epoch;
    let expected;
    try {
      store.epoch = txn.owner_epoch;
      expected = acceptWorldChange(
        store,
        store.read<WorldBatch>(old.action.parameters_ref),
        { kind: "MODEL", scope: old.scope, owner_epoch: txn.owner_epoch },
        receipt.applied_at,
      );
    } finally {
      store.epoch = oldEpoch;
    }
    const actual = staged.filter((x) =>
      ["WorldEntity", "WorldAssertion"].includes(x.record_type),
    );
    if (
      !isDeepStrictEqual(expected.records, actual) ||
      !isDeepStrictEqual(expected.result_ids, receipt.result_ids) ||
      !isDeepStrictEqual(expected.conflicts, receipt.conflicts)
    )
      throw Error("WORLD_APPROVED_MUTATIONS_MISMATCH");
  }
}
