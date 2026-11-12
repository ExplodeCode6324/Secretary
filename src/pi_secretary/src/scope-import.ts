import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { Store, base, now, revise, shapeDefinition } from "./store.ts";
import type {
  Input,
  Operation,
  AuthorizationRequest,
  Scope,
  WorkScope,
  ScopeImportProposal,
  ScopeImportParameters,
} from "./contracts.ts";
import { Authorization } from "./authorization.ts";
import { Scopes, directoryRoot, relativePath } from "./scopes.ts";
import { stableID } from "./execution-utils.ts";
import { evidenceSource } from "./world-accept.ts";

export const importScopeID = (operationID: string) =>
  stableID("scope-import:" + operationID);
export const importResultKey = (operationID: string) =>
  "scope-import-result:" + operationID;
export function importEvidence(
  store: Store,
  ids: string[],
  scope: Scope,
  loopID: string,
) {
  if (!scope.session_id || scope.task_id || scope.execution_id || !loopID)
    throw Error("SCOPE_IMPORT_MAIN_ONLY");
  const evidence = evidenceSource(store, ids, scope);
  if (evidence.kind !== "MASTER") throw Error("SCOPE_MASTER_EVIDENCE_REQUIRED");
  for (const event of evidence.events) {
    if (event.event_type !== "input.accepted")
      throw Error("SCOPE_MASTER_EVIDENCE_REQUIRED");
    const input = store.get<Input>(
      "Input",
      store.read<Input>(event.payload).id,
    );
    if (
      input.loop_id !== loopID ||
      input.failure_action ||
      input.attachments?.length ||
      input.producer !== "MASTER"
    )
      throw Error("SCOPE_CURRENT_MASTER_REQUIRED");
  }
  const inputs = store.all<Input>("Input").filter((i) => i.loop_id === loopID);
  if (inputs.some((i) => i.producer === "ENVIRONMENT" || i.failure_action))
    throw Error("SCOPE_CURRENT_MASTER_REQUIRED");
}
export function normalizeImport(
  store: Store,
  proposal: ScopeImportProposal,
  scopes = new Scopes(store),
) {
  shapeDefinition("ScopeImportProposal", proposal);
  const name = proposal.name.trim();
  if (!name) throw Error("INVALID_SCOPE_NAME");
  const value = {
    name,
    description: proposal.description ?? "",
    kind: proposal.kind,
    root_path: null as string | null,
    notes_path: null as string | null,
    default_write:
      proposal.default_write ??
      (proposal.kind === "DIRECTORY" ? "ask" : "allow"),
    identity: null as { device: string; inode: string } | null,
  };
  if (proposal.kind === "DIRECTORY") {
    if (!proposal.root_path) throw Error("INVALID_SCOPE_ROOT");
    value.root_path = directoryRoot(store, proposal.root_path);
    value.notes_path = proposal.notes_path ?? ".secretary/NOTES.md";
    relativePath(value.root_path, value.notes_path);
    if (scopes.conflict(value.root_path, null))
      throw Error("SCOPE_ROOT_CONFLICT");
    const stat = fs.statSync(value.root_path, { bigint: true });
    value.identity = { device: String(stat.dev), inode: String(stat.ino) };
  } else if (proposal.root_path != null || proposal.notes_path != null)
    throw Error("NONE_SCOPE_PATH_FORBIDDEN");
  return value;
}
export function checkImport(
  store: Store,
  params: ScopeImportParameters,
  op: Operation,
  scopes = new Scopes(store),
) {
  shapeDefinition("ScopeImportParameters", params);
  if (op.owner_epoch !== store.epoch) throw Error("STALE_OWNER");
  importEvidence(store, params.source_event_ids, op.scope, params.loop_id);
  const { identity, ...proposal } = params.proposal;
  const checked = normalizeImport(store, proposal, scopes);
  if (!isDeepStrictEqual(checked, params.proposal))
    throw Error("SCOPE_DIRECTORY_CHANGED");
  return checked;
}
export function importedScope(
  op: Operation,
  params: ScopeImportParameters,
  at: string,
): WorkScope {
  const { identity, ...values } = params.proposal;
  return {
    ...base(importScopeID(op.id)),
    updated_at: at,
    schema_version: 1,
    record_type: "Scope",
    state: "ACTIVE",
    ...values,
  };
}
export function importNotice(
  store: Store,
  op: Operation,
  result: unknown,
  at: string,
): Input {
  const params = store.read<ScopeImportParameters>(op.action.parameters_ref);
  return {
    ...base(stableID(importResultKey(op.id))),
    updated_at: at,
    schema_version: 1,
    record_type: "Input",
    session_id: op.scope.session_id!,
    dedupe_key: importResultKey(op.id),
    producer: "ENVIRONMENT",
    state: "ACCEPTED",
    payload: store.put(
      JSON.stringify({
        type: "scope.import.result",
        operation_id: op.id,
        source_event_ids: params.source_event_ids,
        result,
        authority:
          "HOST notification only; read/query/report. No new work or mutation.",
      }),
      "text/plain",
    ),
    received_at: at,
    loop_id: null,
    feedback_id: null,
  };
}
export class ScopeImports {
  private frameOffset = 0;
  private pending = new Set<string>();
  private collect() {
    // Read each committed frame once. Startup replays the index; warmed idle pumps
    // do no history traversal, including when thousands of imports are terminal.
    while (this.frameOffset < this.store.projectionFrames.length) {
      const frame = this.store.projectionFrames[this.frameOffset++];
      for (const mutation of frame.mutations) {
        if (mutation.object_type !== "Operation") continue;
        const op = this.store.get<Operation>("Operation", mutation.object_id);
        if (op.action.action !== "scope.import") continue;
        if (this.store.find("Input", stableID(importResultKey(op.id))))
          this.pending.delete(op.id);
        else this.pending.add(op.id);
      }
    }
  }
  constructor(
    readonly store: Store,
    readonly auth: Authorization,
    readonly scopes = new Scopes(store),
  ) {}
  propose(
    proposal: ScopeImportProposal,
    sources: string[],
    scope: Scope,
    loopID: string,
    requestID: string,
  ) {
    const source_event_ids = [...sources].sort();
    const prior = this.store
      .all<Operation>("Operation")
      .find((o) => o.action.intent_id === requestID);
    // A retry after a successful DIRECTORY import must not fail on its own newly-created root.
    if (prior) {
      const saved = this.store.read<ScopeImportParameters>(
        prior.action.parameters_ref,
      );
      if (
        prior.action.action !== "scope.import" ||
        !isDeepStrictEqual(prior.scope, scope) ||
        !isDeepStrictEqual(saved.request, proposal) ||
        !isDeepStrictEqual(saved.source_event_ids, source_event_ids) ||
        saved.loop_id !== loopID
      )
        throw Error("INTENT_CONFLICT");
      return this.status(prior);
    }
    importEvidence(this.store, sources, scope, loopID);
    if (
      sources.some(
        (eventID) =>
          this.store.get<Input>(
            "Input",
            this.store.read<Input>(this.store.eventById(eventID)!.payload).id,
          ).state !== "CLAIMED",
      )
    )
      throw Error("SCOPE_CURRENT_MASTER_REQUIRED");
    const params: ScopeImportParameters = {
      version: 1,
      request: proposal,
      proposal: normalizeImport(this.store, proposal, this.scopes),
      source_event_ids,
      loop_id: loopID,
    };
    const op = this.auth.prepare(
      scope,
      "scope.import",
      "scope/import/" + requestID,
      params,
      requestID,
    );
    return this.status(op);
  }
  status(op: Operation) {
    const grant = this.store.get<AuthorizationRequest>(
      "AuthorizationRequest",
      op.authorization_id!,
    );
    return {
      operation_id: op.id,
      request_id: op.action.intent_id,
      authorization_id: grant.id,
      state: op.state,
      authorization_state: grant.state,
      expires_at: grant.expires_at,
      scope_id: op.state === "SUCCEEDED" ? importScopeID(op.id) : null,
      error: op.error,
      result: op.receipt
        ? this.store.read(op.receipt)
        : op.state === "CANCELLED"
          ? {
              status: grant.state,
              reason: op.error ?? "Owner " + grant.state.toLowerCase(),
              actor: grant.decided_by ?? "HOST",
            }
          : null,
    };
  }
  query(
    sessionID: string,
    options: {
      kind?: "scopes" | "imports";
      id?: string;
      cursor?: string;
      limit?: number;
    } = {},
  ) {
    const kind = options.kind ?? "scopes",
      limit = options.limit ?? 30;
    if (
      !["scopes", "imports"].includes(kind) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw Error("INVALID_QUERY");
    const values =
      kind === "scopes"
        ? this.store
            .all<WorkScope>("Scope")
            .filter((s) =>
              options.id ? s.id === options.id : s.state === "ACTIVE",
            )
        : this.store
            .all<Operation>("Operation")
            .filter(
              (o) =>
                o.action.action === "scope.import" &&
                o.scope.session_id === sessionID &&
                (!options.id || o.id === options.id),
            );
    let after = "";
    if (options.cursor) {
      try {
        const c = JSON.parse(
          Buffer.from(options.cursor, "base64url").toString(),
        );
        if (
          c.kind !== kind ||
          c.session !== sessionID ||
          c.id !== (options.id ?? null) ||
          typeof c.after !== "string"
        )
          throw Error();
        after = c.after;
      } catch {
        throw Error("INVALID_CURSOR");
      }
    }
    const ordered = values
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .filter((v) => v.id > after);
    const page = ordered.slice(0, limit);
    return {
      items: page.map((v) =>
        v.record_type === "Operation" ? this.status(v) : v,
      ),
      next_cursor:
        ordered.length > limit
          ? Buffer.from(
              JSON.stringify({
                kind,
                session: sessionID,
                id: options.id ?? null,
                after: page.at(-1)!.id,
              }),
            ).toString("base64url")
          : null,
    };
  }
  drain() {
    this.collect();
    for (const operationID of this.pending) {
      const op = this.store.get<Operation>("Operation", operationID);
      if (this.store.find("Input", stableID(importResultKey(op.id)))) {
        this.pending.delete(op.id);
        continue;
      }
      const grant = this.store.get<AuthorizationRequest>(
        "AuthorizationRequest",
        op.authorization_id!,
      );
      if (["SUCCEEDED", "CANCELLED"].includes(op.state)) {
        const result = op.receipt
          ? this.store.read(op.receipt)
          : {
              status: grant.state,
              reason: op.error ?? "Owner " + grant.state.toLowerCase(),
              actor: grant.decided_by ?? "HOST",
            };
        const input = importNotice(this.store, op, result, now());
        this.store.commit(
          [input],
          [this.store.event("input.accepted", input, op.scope, "HOST")],
        );
        continue;
      }
      if (!["WAIT_AUTH", "AUTHORIZED"].includes(op.state)) continue;
      if (grant.expires_at && Date.parse(grant.expires_at) <= Date.now()) {
        this.fail(op, grant, "EXPIRED", "Authorization expired");
        continue;
      }
      if (op.state !== "AUTHORIZED") continue;
      try {
        if (
          grant.state !== "APPROVED" ||
          !isDeepStrictEqual(grant.action, op.action) ||
          op.action.parameters_ref.sha256 !== op.action.parameters_hash
        )
          throw Error("GRANT_INVALID");
        const params = this.store.read<ScopeImportParameters>(
          op.action.parameters_ref,
        );
        checkImport(this.store, params, op, this.scopes);
        const at = now(),
          scope = importedScope(op, params, at);
        const result = {
          status: "SUCCEEDED",
          operation_id: op.id,
          scope_id: scope.id,
          applied_at: at,
          actor: "HOST",
        };
        const done = revise(op, {
          state: "SUCCEEDED",
          effect: "APPLIED",
          receipt: this.store.put(result),
          updated_at: at,
        });
        const input = importNotice(this.store, done, result, at);
        this.store.commit(
          [
            scope,
            revise(grant, {
              state: "CONSUMED",
              consumed_at: at,
              updated_at: at,
            }),
            done,
            input,
          ],
          [
            this.store.event(
              "scope.imported",
              {
                scope,
                operation_id: op.id,
                source_event_ids: params.source_event_ids,
              },
              op.scope,
              "HOST",
            ),
            this.store.event(
              "operation.journal_applied",
              done,
              op.scope,
              "HOST",
            ),
            this.store.event("input.accepted", input, op.scope, "HOST"),
          ],
        );
      } catch (error) {
        this.fail(op, grant, "REVOKED", String(error));
      }
    }
  }
  private fail(
    op: Operation,
    grant: AuthorizationRequest,
    state: "REVOKED" | "EXPIRED",
    reason: string,
  ) {
    const at = now(),
      result = {
        status: state === "EXPIRED" ? "EXPIRED" : "FAILED",
        operation_id: op.id,
        reason,
        actor: "HOST",
      };
    const done = revise(op, {
      state: "CANCELLED",
      effect: "NOT_STARTED",
      error: reason,
      receipt: this.store.put(result),
      updated_at: at,
    });
    const input = importNotice(this.store, done, result, at);
    this.store.commit(
      [done, revise(grant, { state, updated_at: at }), input],
      [
        this.store.event("scope.import_failed", result, op.scope, "HOST"),
        this.store.event("input.accepted", input, op.scope, "HOST"),
      ],
    );
  }
}
