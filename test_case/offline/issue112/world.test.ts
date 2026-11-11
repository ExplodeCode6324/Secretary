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
test("fresh World roles are persistent and available without PostgreSQL", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-issue112-"));
  let app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
  try {
    assert.ok(app.world, "World must not depend on the log search DSN");
    const roles = app.store
      .all<any>("WorldEntity" as any)
      .filter((e) => e.role);
    assert.equal(roles.length, 2);
    await app.close();
    app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
    assert.deepEqual(
      app.store.all<any>("WorldEntity" as any).filter((e) => e.role),
      roles,
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import type {
  AuthorizationRequest,
  WorldAssertion,
} from "../../../src/pi_secretary/src/contracts.ts";
import type {
  WorldBatch,
  WorldEdit,
} from "../../../src/pi_secretary/src/world-accept.ts";
async function fixture(run: (app: App) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-issue112-"));
  const app = await App.open(dir, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  try {
    await run(app);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
function evidence(app: App) {
  app.host.accept("Master states: Alice prefers tea. Be concise.");
  return app.store.events("input.accepted").at(-1)!.event_id;
}
function batch(edits: WorldEdit[], ev: string): WorldBatch {
  return {
    version: 1,
    batch_id: id(),
    changes: edits.map((c) => ({ ...c, source_event_ids: [ev] })),
  };
}
function approve(app: App, b: WorldBatch) {
  const scope = {
    session_id: app.host.sessionID,
    task_id: null,
    execution_id: null,
  };
  const proposed = app.world!.propose(b, scope);
  const a = app.store.get<AuthorizationRequest>(
    "AuthorizationRequest",
    proposed.authorization_id!,
  );
  app.authorization.decide({
    record_type: "ApprovalCommand",
    schema_version: 1,
    request_id: id(),
    authorization_id: a.id,
    expected_revision: a.revision,
    display_hash: a.display_hash,
    decision: "APPROVE",
  });
  return proposed;
}
test("one approved batch creates a person and fact, never Settings or an extra Main input", () =>
  fixture(async (app) => {
    const ev = evidence(app),
      b = batch(
        [
          {
            intent: "CREATE_ENTITY",
            local_ref: "$alice",
            entity_kind: "PERSON",
            display_name: "Alice",
            aliases: { add: ["小艾"] },
          },
          {
            intent: "ASSERT",
            subject: "$alice",
            predicate: "preference.statement",
            topic: "other",
            value: "Prefers tea, not coffee",
          },
        ],
        ev,
      );
    const inputCount = app.store.all("Input").length,
      settings = app.store.all("SettingsApplication").length;
    const p = approve(app, b);
    await app.world!.drain();
    assert.equal(
      app.world!.batch(b.batch_id, app.host.sessionID).status,
      "COMMITTED",
    );
    assert.equal(app.store.all("Input").length, inputCount);
    assert.equal(app.store.all("SettingsApplication").length, settings);
    assert.equal(app.store.all("WorldAssertion").length, 1);
    assert.equal(
      app.world!.propose(b, {
        session_id: app.host.sessionID,
        task_id: null,
        execution_id: null,
      }).status,
      "COMMITTED",
    );
    assert.throws(
      () =>
        app.world!.propose(
          { ...b, changes: [] },
          { session_id: app.host.sessionID, task_id: null, execution_id: null },
        ),
      /INTENT_CONFLICT/,
    );
    assert.equal(
      app.store.get<AuthorizationRequest>(
        "AuthorizationRequest",
        p.authorization_id!,
      ).state,
      "CONSUMED",
    );
    assert.equal(app.store.events("operation.dispatched").length, 0);
  }));
test("invalid batch leaves no partial entity; role protection and retired predicates", () =>
  fixture(async (app) => {
    const ev = evidence(app),
      scope = {
        session_id: app.host.sessionID,
        task_id: null,
        execution_id: null,
      };
    const b = batch(
      [
        {
          intent: "CREATE_ENTITY",
          local_ref: "$x",
          entity_kind: "PERSON",
          display_name: "Candidate",
        },
        {
          intent: "ASSERT",
          subject: "$x",
          predicate: "person.height",
          value: 180,
        },
      ],
      ev,
    );
    assert.throws(() => app.world!.propose(b, scope), /PREDICATE_RETIRED/);
    assert.equal(app.world!.entities().length, 2);
    const master = app.world!.entities().find((e) => e.role === "MASTER")!;
    assert.throws(
      () => app.store.commit([revise(master, { role: null })]),
      /IDENTITY_IMMUTABLE|ACCEPTOR_REQUIRED/,
    );
    assert.throws(
      () =>
        app.world!.propose(
          batch([{ intent: "RETIRE_ENTITY", subject: "role:master" }], ev),
          scope,
        ),
      /ROLE/,
    );
  }));
test("ASSERT preserves conflicts and CORRECT names a live target; assertion body is immutable", () =>
  fixture(async (app) => {
    const ev = evidence(app);
    for (const value of ["Use English", "Use Chinese"]) {
      const b = batch(
        [
          {
            intent: "ASSERT",
            subject: "role:master",
            predicate: "entity.guideline",
            topic: "communication",
            value,
          },
        ],
        ev,
      );
      approve(app, b);
      await app.world!.drain();
    }
    const facts = app.store.all<WorldAssertion>("WorldAssertion");
    assert.equal(facts.length, 2);
    assert(facts.every((f) => f.status === "LIVE"));
    const c = batch(
      [
        {
          intent: "CORRECT",
          subject: "role:master",
          predicate: "entity.guideline",
          topic: "communication",
          target_fact_id: facts[0].id,
          value: "Use English when requested",
        },
      ],
      ev,
    );
    approve(app, c);
    await app.world!.drain();
    assert.equal(
      app.store.get<WorldAssertion>("WorldAssertion", facts[0].id).status,
      "SUPERSEDED",
    );
    assert.throws(
      () => app.store.commit([revise(facts[1], { value: "Changed" })]),
      /ASSERTION_IMMUTABLE|ACCEPTOR_REQUIRED/,
    );
  }));
test("opposite alias deltas follow durable approval order and name edits check stale base", () =>
  fixture(async (app) => {
    const ev = evidence(app);
    const first = batch(
        [
          {
            intent: "EDIT_ENTITY",
            subject: "role:master",
            aliases: { add: ["Boss"] },
          },
        ],
        ev,
      ),
      second = batch(
        [
          {
            intent: "EDIT_ENTITY",
            subject: "role:master",
            aliases: { remove: ["Boss"] },
          },
        ],
        ev,
      );
    approve(app, first);
    approve(app, second);
    await app.world!.drain();
    assert.deepEqual(app.world!.resolve("role:master").entity!.aliases, []);
    const stale = batch(
      [
        {
          intent: "EDIT_ENTITY",
          subject: "role:master",
          rename: { from: "Master", to: "Commander" },
        },
      ],
      ev,
    );
    approve(app, stale);
    app.world!.ownerChange(
      {
        version: 1,
        batch_id: id(),
        changes: [
          {
            intent: "EDIT_ENTITY",
            subject: "role:master",
            rename: { from: "Master", to: "Owner" },
          },
        ],
      },
      { session_id: app.host.sessionID, task_id: null, execution_id: null },
    );
    await app.world!.drain();
    assert.equal(
      app.world!.batch(stale.batch_id, app.host.sessionID).status,
      "FAILED",
    );
    assert.equal(
      app.world!.resolve("role:master").entity!.display_name,
      "Owner",
    );
  }));
test("24-hour expiry and stale owner have durable failure without Main wake", () =>
  fixture(async (app) => {
    const ev = evidence(app),
      b = batch(
        [
          {
            intent: "ASSERT",
            subject: "role:master",
            predicate: "preference.statement",
            value: "Tea",
          },
        ],
        ev,
      ),
      p = approve(app, b);
    const a = app.store.get<AuthorizationRequest>(
      "AuthorizationRequest",
      p.authorization_id!,
    );
    app.store.commit([
      revise(a, { expires_at: new Date(Date.now() - 1).toISOString() }),
    ]);
    await app.world!.drain();
    assert.equal(
      app.world!.batch(b.batch_id, app.host.sessionID).status,
      "EXPIRED",
    );
    assert.equal(app.store.all("WorldAssertion").length, 0);
    const second = batch(
        [
          {
            intent: "ASSERT",
            subject: "role:master",
            predicate: "preference.statement",
            value: "Tea",
          },
        ],
        ev,
      ),
      q = approve(app, second);
    const op = app.store.get<any>("Operation", q.operation_id);
    app.store.commit([revise(op, { owner_epoch: app.store.epoch + 1 })]);
    await app.world!.drain();
    assert.equal(
      app.world!.batch(second.batch_id, app.host.sessionID).status,
      "FAILED",
    );
    assert.match(
      app.world!.batch(second.batch_id, app.host.sessionID).error!,
      /STALE_OWNER/,
    );
  }));
test("a journal_applied event cannot bypass the exact operation and grant bundle", () =>
  fixture(async (app) => {
    const ev = evidence(app),
      b = batch(
        [
          {
            intent: "ASSERT",
            subject: "role:master",
            predicate: "preference.statement",
            value: "Synthetic forged fact",
          },
        ],
        ev,
      ),
      preview = app.world!.preview(b, {
        session_id: app.host.sessionID,
        task_id: null,
        execution_id: null,
      });
    const sequence = app.store.sequence;
    assert.throws(
      () =>
        app.store.commit(preview.records, [
          app.store.event("operation.journal_applied", { synthetic: true }),
        ]),
      /WORLD_APPLY_BUNDLE_REQUIRED/,
    );
    assert.equal(app.store.sequence, sequence);
    assert.equal(app.store.all("WorldAssertion").length, 0);
  }));
