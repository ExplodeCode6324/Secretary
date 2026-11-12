import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import {
  Store,
  base,
  id,
  now,
  revise,
} from "../../../src/pi_secretary/src/store.ts";
import {
  checkImport,
  importNotice,
  importedScope,
  importResultKey,
} from "../../../src/pi_secretary/src/scope-import.ts";
import type {
  Input,
  Operation,
  AuthorizationRequest,
  ScopeImportProposal,
  ScopeImportParameters,
} from "../../../src/pi_secretary/src/contracts.ts";
import { inputMessage } from "../../../src/pi_secretary/src/input-projection.ts";
import { isHostNoticeMessage } from "../../../src/pi_secretary/src/input-origin.ts";
import { evidenceSource } from "../../../src/pi_secretary/src/world-accept.ts";
import { searchDocument } from "../../../src/pi_secretary/src/memory-search.ts";
import { summaryMessage } from "../../../src/pi_secretary/src/attachment-form.ts";

export async function fixture(
  run: (app: App, root: string, dir: string) => Promise<void>,
) {
  const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "secretary-issue113-")),
    ),
    dir = path.join(root, "core");
  const app = await App.open(dir, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  try {
    await run(app, root, dir);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
export function propose(
  app: App,
  proposal: ScopeImportProposal = { name: "Research", kind: "NONE" },
) {
  const input = app.host.accept("Please import the research scope"),
    loop = id();
  app.store.commit([revise(input, { state: "CLAIMED", loop_id: loop })], []);
  const event = app.store.events("input.accepted").at(-1)!.event_id;
  const scope = {
      session_id: app.host.sessionID,
      task_id: null,
      execution_id: null,
    },
    request = id();
  const status = app.scopeImports.propose(
    proposal,
    [event],
    scope,
    loop,
    request,
  );
  return { status, event, loop, scope, request, proposal, input };
}
export function decide(
  app: App,
  opID: string,
  decision: "APPROVE" | "REJECT" | "REVOKE",
) {
  const op = app.store.get<Operation>("Operation", opID),
    a = app.store.get<AuthorizationRequest>(
      "AuthorizationRequest",
      op.authorization_id!,
    );
  return app.authorization.decide({
    schema_version: 1,
    record_type: "ApprovalCommand",
    request_id: id(),
    authorization_id: a.id,
    expected_revision: a.revision,
    display_hash: a.display_hash,
    decision,
  });
}
const notices = (app: App) =>
  app.store.all<Input>("Input").filter((i) => i.producer === "ENVIRONMENT");
for (const outcome of ["success", "expired", "rejected"] as const)
  test(`historical ${outcome} import notice replays after wording/serialization changes without CAS writes`, async () => {
    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "secretary-issue113-replay-")),
    );
    let app: App | undefined;
    let reopened: Store | undefined;
    const originalPut = Store.prototype.put;
    try {
      app = await App.open(root, {
        model: fixtureModel,
        stream: fixtureStream,
      });
      const x = propose(app);
      if (outcome === "success") decide(app, x.status.operation_id, "APPROVE");
      else if (outcome === "rejected")
        decide(app, x.status.operation_id, "REJECT");
      else {
        const grant = app.store.get<AuthorizationRequest>(
          "AuthorizationRequest",
          x.status.authorization_id,
        );
        app.store.commit(
          [
            revise(grant, {
              expires_at: new Date(Date.now() - 1000).toISOString(),
            }),
          ],
          [],
        );
      }
      // Simulate a prior writer's notice format, including different key order.
      app.store.put = function (value, media) {
        if (
          typeof value === "string" &&
          value.startsWith('{"type":"scope.import.result"')
        ) {
          const old = JSON.parse(value);
          value = JSON.stringify({
            legacy_display: "v0",
            ...Object.fromEntries(Object.entries(old).reverse()),
            authority: "Historical HOST notice wording",
          });
        }
        return originalPut.call(this, value, media);
      };
      app.scopeImports.drain();
      const notice = notices(app)[0];
      assert.match(
        app.store.bytes(notice.payload).toString(),
        /Historical HOST notice wording/,
      );
      await app.close();
      app = undefined;
      Store.prototype.put = function () {
        throw Error("REPLAY_MUST_NOT_WRITE_CAS");
      };
      reopened = await Store.open(root);
      assert.deepEqual(reopened.inputAcceptedEventIDs(x.input.id), [x.event]);
      assert.deepEqual(reopened.get<Input>("Input", notice.id), notice);
      assert.equal(reopened.all("Scope").length, outcome === "success" ? 1 : 0);
      assert.equal(
        reopened.get<Operation>("Operation", x.status.operation_id).state,
        outcome === "success" ? "SUCCEEDED" : "CANCELLED",
      );
    } finally {
      Store.prototype.put = originalPut;
      await reopened?.close();
      await app?.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
for (const kind of ["NONE", "DIRECTORY"] as const)
  test(`${kind}: exact approval creates one atomic scope and durable receipt, retries retain result`, () =>
    fixture(async (app, root) => {
      const directory = path.join(root, "research");
      fs.mkdirSync(directory);
      const x = propose(app, {
        name: " Research ",
        kind,
        ...(kind === "DIRECTORY" ? { root_path: directory } : {}),
      });
      assert.equal(app.store.all("Scope").length, 0);
      const op = app.store.get<Operation>("Operation", x.status.operation_id);
      assert.throws(
        () => app.authorization.dispatch(op.id),
        /JOURNAL_APPLY_REQUIRED/,
      );
      decide(app, op.id, "APPROVE");
      app.scopeImports.drain();
      const scopes = app.store.all<any>("Scope");
      assert.equal(scopes.length, 1);
      assert.equal(scopes[0].revision, 1);
      assert.equal(scopes[0].name, "Research");
      assert.equal(
        scopes[0].default_write,
        kind === "DIRECTORY" ? "ask" : "allow",
      );
      const done = app.scopeImports.propose(
        x.proposal,
        [x.event],
        x.scope,
        x.loop,
        x.request,
      );
      assert.equal(done.state, "SUCCEEDED");
      assert.equal(done.authorization_state, "CONSUMED");
      assert.throws(
        () =>
          app.scopeImports.propose(
            { ...x.proposal, name: "Other" },
            [x.event],
            x.scope,
            x.loop,
            x.request,
          ),
        /INTENT_CONFLICT/,
      );
      assert.throws(() => decide(app, op.id, "REVOKE"), /INVALID_TRANSITION/);
      app.scopeImports.drain();
      assert.equal(notices(app).length, 1);
      const frame = app.store.projectionFrames.find((f) =>
        f.mutations.some((m) => m.object_type === "Scope"),
      )!;
      assert.deepEqual(frame.mutations.map((m) => m.object_type).sort(), [
        "AuthorizationRequest",
        "Input",
        "Operation",
        "Scope",
      ]);
      assert.equal(app.store.events("input.accepted").at(-1)!.actor, "HOST");
    }));
for (const decision of ["REJECT", "REVOKE"] as const)
  test(`${decision}: online reconciliation writes exactly one result without effect`, () =>
    fixture(async (app) => {
      const x = propose(app);
      if (decision === "REVOKE") decide(app, x.status.operation_id, "APPROVE");
      decide(app, x.status.operation_id, decision);
      assert.equal(notices(app).length, 0);
      app.scopeImports.drain();
      app.scopeImports.drain();
      assert.equal(notices(app).length, 1);
      assert.equal(app.store.all("Scope").length, 0);
      assert.match(
        app.store.bytes(notices(app)[0].payload).toString(),
        new RegExp(decision === "REJECT" ? "REJECTED" : "REVOKED"),
      );
    }));
for (const approved of [false, true])
  test(`online expiry ${approved ? "approved" : "pending"} cancels grant and writes result atomically`, () =>
    fixture(async (app) => {
      const x = propose(app);
      if (approved) decide(app, x.status.operation_id, "APPROVE");
      const a = app.store.get<AuthorizationRequest>(
        "AuthorizationRequest",
        x.status.authorization_id,
      );
      app.store.commit(
        [revise(a, { expires_at: new Date(Date.now() - 1000).toISOString() })],
        [],
      );
      app.scopeImports.drain();
      const after = app.store.get<AuthorizationRequest>(
        "AuthorizationRequest",
        a.id,
      );
      assert.equal(after.state, "EXPIRED");
      assert.equal(after.decided_by, approved ? "MASTER_UI" : null);
      assert.equal(
        app.store.get<Operation>("Operation", x.status.operation_id).effect,
        "NOT_STARTED",
      );
      assert.equal(notices(app).length, 1);
      assert.equal(app.store.all("Scope").length, 0);
    }));
test("directory replacement and new overlap invalidate original approval", () =>
  fixture(async (app, root) => {
    for (const mode of ["replacement", "overlap"]) {
      const directory = path.join(root, mode);
      fs.mkdirSync(directory);
      const x = propose(app, {
        name: mode,
        kind: "DIRECTORY",
        root_path: directory,
      });
      decide(app, x.status.operation_id, "APPROVE");
      if (mode === "replacement") {
        fs.renameSync(directory, directory + "-old");
        fs.mkdirSync(directory);
      } else
        app.scheduler.scopes.save({
          name: "Owner scope",
          kind: "DIRECTORY",
          root_path: directory,
        });
      app.scopeImports.drain();
      const op = app.store.get<Operation>("Operation", x.status.operation_id);
      assert.equal(op.state, "CANCELLED");
      assert.equal(op.effect, "NOT_STARTED");
      assert.match(op.error!, /SCOPE_DIRECTORY_CHANGED|SCOPE_ROOT_CONFLICT/);
      assert.equal(
        app.store.get<AuthorizationRequest>(
          "AuthorizationRequest",
          x.status.authorization_id,
        ).decided_by,
        "MASTER_UI",
      );
    }
  }));
test("path admission rejects symlinks, relative roots, Core overlap and unsafe notes", () =>
  fixture(async (app, root, dir) => {
    const directory = path.join(root, "real");
    fs.mkdirSync(directory);
    fs.symlinkSync(directory, path.join(root, "link"));
    for (const [root_path, notes_path] of [
      ["relative", undefined],
      [path.join(root, "link"), undefined],
      [dir, undefined],
      [directory, "../escape"],
      [directory, "/absolute"],
    ]) {
      assert.throws(
        () =>
          propose(app, {
            name: "invalid",
            kind: "DIRECTORY",
            root_path,
            notes_path,
          }),
        /INVALID_PATH|SYMLINK_REJECTED|SCOPE_ROOT_RESERVED/,
      );
    }
    assert.equal(app.store.all("Operation").length, 0);
  }));
test("Master evidence is explicit, same loop/session and no ENVIRONMENT or failure authority", () =>
  fixture(async (app) => {
    const x = propose(app);
    assert.throws(
      () => app.scopeImports.propose(x.proposal, [], x.scope, x.loop, id()),
      /EVIDENCE_REQUIRED/,
    );
    assert.throws(
      () =>
        app.scopeImports.propose(
          x.proposal,
          [x.event],
          { ...x.scope, session_id: id() },
          x.loop,
          id(),
        ),
      /SOURCE_EVENT_MISMATCH/,
    );
    assert.throws(
      () =>
        app.scopeImports.propose(x.proposal, [x.event], x.scope, id(), id()),
      /SCOPE_CURRENT_MASTER_REQUIRED/,
    );
    const env = app.host.accept("Import more", id(), "ENVIRONMENT"),
      loop = id();
    app.store.commit([revise(env, { state: "CLAIMED", loop_id: loop })], []);
    const event = app.store.events("input.accepted").at(-1)!;
    assert.equal(event.actor, "HOST");
    assert.throws(
      () =>
        app.scopeImports.propose(
          x.proposal,
          [event.event_id],
          x.scope,
          loop,
          id(),
        ),
      /SOURCE_EVENT_NOT_STATEMENT/,
    );
    const tools = (app.host as any).tools(loop);
    for (const name of [
      "scope_import",
      "memory_propose_change",
      "task_propose",
      "task_control",
      "schedule_wakeup",
    ]) {
      const tool = tools.find((t: any) => t.name === name);
      assert.ok(tool, "mutation tool is present for guard test: " + name);
      await assert.rejects(tool.execute(id(), {}), /ENVIRONMENT_READ_ONLY/);
    }
    assert.ok(isHostNoticeMessage(app.store, inputMessage(app.store, env)));
    assert.equal(searchDocument(app.store, event), null);
    assert.match(
      JSON.stringify(summaryMessage(app.store, inputMessage(app.store, env))),
      /not Master evidence/,
    );
  }));
test("persistent rules and remember cannot bypass import approval; stale owner fails without consumption", () =>
  fixture(async (app) => {
    assert.throws(
      () => app.authorization.rule("scope.import", "*", {}),
      /EXPLICIT_APPROVAL_REQUIRED/,
    );
    const x = propose(app),
      op = app.store.get<Operation>("Operation", x.status.operation_id);
    assert.throws(
      () =>
        app.authorization.remember(op, { path_prefix: ".", expires_at: null }),
      /EXPLICIT_APPROVAL_REQUIRED/,
    );
    decide(app, op.id, "APPROVE");
    app.store.commit(
      [
        revise(app.store.get<Operation>("Operation", op.id), {
          owner_epoch: app.store.epoch + 1,
        }),
      ],
      [],
    );
    app.scopeImports.drain();
    assert.match(
      app.store.get<Operation>("Operation", op.id).error!,
      /STALE_OWNER/,
    );
    assert.equal(app.store.all("Scope").length, 0);
  }));
test("scope query paginates beyond prompt limit and confines imports to session", () =>
  fixture(async (app) => {
    for (let n = 0; n < 37; n++)
      app.scheduler.scopes.save({ name: `Scope ${n}`, kind: "NONE" });
    let cursor: string | undefined,
      ids: string[] = [];
    do {
      const q = app.scopeImports.query(app.host.sessionID, {
        limit: 7,
        cursor,
      });
      ids.push(...q.items.map((s: any) => s.id));
      cursor = q.next_cursor ?? undefined;
    } while (cursor);
    assert.equal(new Set(ids).size, 37);
    const x = propose(app);
    assert.equal(
      app.scopeImports.query(id(), { kind: "imports" }).items.length,
      0,
    );
    assert.equal(
      app.scopeImports.query(app.host.sessionID, {
        kind: "imports",
        id: x.status.operation_id,
      }).items.length,
      1,
    );
  }));
test("whole-frame guard rejects incomplete and parameter-tampered apply", () =>
  fixture(async (app) => {
    const x = propose(app);
    decide(app, x.status.operation_id, "APPROVE");
    const op = app.store.get<Operation>("Operation", x.status.operation_id),
      a = app.store.get<AuthorizationRequest>(
        "AuthorizationRequest",
        op.authorization_id!,
      );
    const params = app.store.read<ScopeImportParameters>(
        op.action.parameters_ref,
      ),
      at = now(),
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
        receipt: app.store.put(result),
      }),
      input = importNotice(app.store, done, result, at);
    const records = [
      scope,
      revise(a, { state: "CONSUMED", consumed_at: at }),
      done,
      input,
    ];
    const events = [
      app.store.event("operation.journal_applied", done, op.scope),
      app.store.event(
        "scope.imported",
        {
          scope,
          operation_id: op.id,
          source_event_ids: params.source_event_ids,
        },
        op.scope,
      ),
      app.store.event("input.accepted", input, op.scope),
    ];
    assert.throws(
      () => app.store.commit(records.slice(0, 3), events),
      /SCOPE_RESULT_NOT_ATOMIC/,
    );
    assert.throws(
      () =>
        app.store.commit(
          [{ ...scope, name: "Tampered" }, ...records.slice(1)],
          events,
        ),
      /SCOPE_APPLY_BUNDLE_REQUIRED/,
    );
    const changedInput = {
      ...input,
      payload: app.store.put("Changed HOST notice", "text/plain"),
    };
    assert.throws(
      () =>
        app.store.commit(
          [...records.slice(0, 3), changedInput],
          [
            ...events.slice(0, 2),
            app.store.event("input.accepted", changedInput, op.scope, "HOST"),
          ],
        ),
      /SCOPE_RESULT_NOT_ATOMIC/,
    );
    assert.equal(
      app.store.get<AuthorizationRequest>("AuthorizationRequest", a.id).state,
      "APPROVED",
    );
    app.scopeImports.drain();
    assert.equal(app.store.all("Scope").length, 1);
  }));
test("changed operation parameters never reuse a grant and fail without consuming it", () =>
  fixture(async (app) => {
    const x = propose(app);
    decide(app, x.status.operation_id, "APPROVE");
    const op = app.store.get<Operation>("Operation", x.status.operation_id);
    const params = app.store.read<ScopeImportParameters>(
      op.action.parameters_ref,
    );
    const changed = app.store.put({
      ...params,
      proposal: { ...params.proposal, name: "Unapproved" },
    });
    app.store.commit(
      [
        revise(op, {
          action: {
            ...op.action,
            parameters_ref: changed,
            parameters_hash: changed.sha256,
          },
        }),
      ],
      [],
    );
    app.scopeImports.drain();
    assert.equal(
      app.store.get<Operation>("Operation", op.id).state,
      "CANCELLED",
    );
    assert.equal(
      app.store.get<AuthorizationRequest>(
        "AuthorizationRequest",
        op.authorization_id!,
      ).state,
      "REVOKED",
    );
    assert.equal(app.store.all("Scope").length, 0);
    assert.equal(notices(app).length, 1);
  }));
