import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { Store, id } from "../../../src/pi_secretary/src/store.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import { PREDICATES } from "../../../src/pi_secretary/src/world-catalog.ts";
import {
  worldSnapshot,
  recall,
} from "../../../src/pi_secretary/src/world-recall.ts";
import type {
  WorldAssertion,
  AuthorizationRequest,
} from "../../../src/pi_secretary/src/contracts.ts";
const options = { model: fixtureModel, stream: fixtureStream };
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "issue112-review-"));
const scope = (app: App) => ({
  session_id: app.host.sessionID,
  task_id: null,
  execution_id: null,
});
test("R1 pending genesis survives SIGKILL during Main and retries after restart", async () => {
  const dir = temp();
  let app: App | undefined;
  try {
    const store = await Store.open(dir);
    store.commit([], [store.event("world.legacy_expected", {})]);
    await store.close();
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(new URL("./workers/upgrade-crash.ts", import.meta.url)),
        dir,
      ],
      { encoding: "utf8", timeout: 20000 },
    );
    assert.equal(child.signal, "SIGKILL", child.stderr);
    app = await App.open(dir, options);
    assert.equal(app.world!.ready, false);
    await app.world!.initialize();
    assert.doesNotMatch(
      app.world!.error ?? "",
      /REQUIRES_IDLE|PENDING_SETTINGS/,
    );
    await app.host.drain();
    assert.equal(app.host.session.state, "IDLE");
  } finally {
    await app?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("R2 first frame selects fresh before any identity or provider failure", async () => {
  const dir = temp();
  let app: App | undefined;
  try {
    const config = Object.defineProperty({}, "main", {
      get() {
        throw Error("SYNTHETIC_PROVIDER_CONFIG_FAILURE");
      },
    });
    await assert.rejects(
      App.open(dir, config as any),
      /SYNTHETIC_PROVIDER_CONFIG_FAILURE/,
    );
    app = await App.open(dir, options);
    assert(app.world!.ready, app.world!.error ?? "");
    assert(
      app.store.projectionFrames[0].log_records.some(
        (e) => e.event_type === "world.bootstrap_selected",
      ),
    );
  } finally {
    await app?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("R3 approved model bundle replays after policy changes with receipt and grant intact", async () => {
  const dir = temp(),
    predicate = PREDICATES.find(
      (p) => p.predicate_key === "preference.statement",
    )!;
  let app: App | undefined;
  try {
    app = await App.open(dir, options);
    app.host.accept("Synthetic Master: prefers tea");
    const evidence = app.store.events("input.accepted").at(-1)!.event_id,
      batchID = id();
    const proposed = app.world!.propose(
      {
        version: 1,
        batch_id: batchID,
        changes: [
          {
            intent: "ASSERT",
            subject: "role:master",
            predicate: predicate.predicate_key,
            value: "Prefers tea",
            source_event_ids: [evidence],
          },
        ],
      },
      scope(app),
    );
    const grant = app.store.get<AuthorizationRequest>(
      "AuthorizationRequest",
      proposed.authorization_id!,
    );
    app.authorization.decide({
      schema_version: 1,
      record_type: "ApprovalCommand",
      request_id: id(),
      authorization_id: grant.id,
      expected_revision: grant.revision,
      display_hash: grant.display_hash,
      decision: "APPROVE",
    });
    await app.world!.drain();
    assert.equal(
      app.world!.batch(batchID, app.host.sessionID).status,
      "COMMITTED",
    );
    await app.close();
    app = undefined;
    predicate.retired = true;
    app = await App.open(dir, options);
    assert.equal(
      app.world!.batch(batchID, app.host.sessionID).status,
      "COMMITTED",
    );
    assert.equal(
      app.store.get<AuthorizationRequest>("AuthorizationRequest", grant.id)
        .state,
      "CONSUMED",
    );
  } finally {
    predicate.retired = false;
    await app?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("review: correction preserves topic and replacement labels; receipts exclude unrelated conflicts", async () => {
  const dir = temp(),
    app = await App.open(dir, options);
  try {
    app.world!.ownerChange(
      {
        version: 1,
        batch_id: id(),
        changes: [
          {
            intent: "ASSERT",
            subject: "role:master",
            predicate: "preference.statement",
            topic: "work",
            value: "Works late at night",
          },
        ],
      },
      scope(app),
    );
    const old = app.store.all<WorldAssertion>("WorldAssertion")[0];
    app.world!.ownerChange(
      {
        version: 1,
        batch_id: id(),
        changes: [
          {
            intent: "CORRECT",
            subject: "role:master",
            predicate: "preference.statement",
            target_fact_id: old.id,
            value: "Works early in morning",
          },
        ],
      },
      scope(app),
    );
    const current = app.store
      .all<WorldAssertion>("WorldAssertion")
      .find((f) => f.status === "LIVE")!;
    assert.equal(current.topic, "work");
    const result = recall(
      worldSnapshot(app.store, new Date().toISOString()),
      "Master work",
      { history: true },
      new Date().toISOString(),
    );
    assert.match(result.text, /SUPERSEDED/);
    assert(result.text.includes("replaces=" + old.id));
    app.world!.ownerChange(
      {
        version: 1,
        batch_id: id(),
        changes: [
          {
            intent: "ASSERT",
            subject: "role:master",
            predicate: "preference.statement",
            topic: "work",
            value: "Works only at noon",
          },
        ],
      },
      scope(app),
    );
    const unrelated = app.world!.ownerChange(
      {
        version: 1,
        batch_id: id(),
        changes: [
          {
            intent: "CREATE_ENTITY",
            entity_kind: "PERSON",
            display_name: "Unrelated person",
          },
        ],
      },
      scope(app),
    );
    assert.deepEqual(
      "conflicts" in unrelated ? unrelated.conflicts : undefined,
      [],
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("review: invalid World mode fails before opening or writing the domain", async () => {
  const dir = temp(),
    old = process.env.SECRETARY_WORLD_RECALL;
  try {
    process.env.SECRETARY_WORLD_RECALL = "invalid";
    await assert.rejects(App.open(dir, options), /INVALID_WORLD_CONTEXT_MODE/);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    if (old === undefined) delete process.env.SECRETARY_WORLD_RECALL;
    else process.env.SECRETARY_WORLD_RECALL = old;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("R2 preexisting domain with no World history can initialize without PostgreSQL", async () => {
  const dir = temp();
  let app: App | undefined;
  try {
    const store = await Store.open(dir);
    store.commit([], [store.event("synthetic.old_domain", {})]);
    await store.close();
    app = await App.open(dir, options);
    assert(app.world!.ready, app.world!.error ?? "");
  } finally {
    await app?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("R3 authentic owner frames replay after current predicate retirement; new writes still reject", async () => {
  const dir = temp(),
    predicate = PREDICATES.find(
      (p) => p.predicate_key === "preference.statement",
    )!;
  let app: App | undefined;
  try {
    app = await App.open(dir, options);
    app.world!.ownerChange(
      {
        version: 1,
        batch_id: id(),
        changes: [
          {
            intent: "ASSERT",
            subject: "role:master",
            predicate: predicate.predicate_key,
            value: "Synthetic preference",
          },
        ],
      },
      scope(app),
    );
    const factID = app.store.all<WorldAssertion>("WorldAssertion")[0].id;
    await app.close();
    app = undefined;
    predicate.retired = true;
    app = await App.open(dir, options);
    assert.equal(app.store.all<WorldAssertion>("WorldAssertion")[0].id, factID);
    assert.throws(
      () =>
        app!.world!.ownerChange(
          {
            version: 1,
            batch_id: id(),
            changes: [
              {
                intent: "ASSERT",
                subject: "role:master",
                predicate: predicate.predicate_key,
                value: "New forbidden write",
              },
            ],
          },
          scope(app!),
        ),
      /PREDICATE_RETIRED/,
    );
  } finally {
    predicate.retired = false;
    await app?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("R4 historical recall labels retraction, validity, replacement and current staleness", async () => {
  const dir = temp();
  const app = await App.open(dir, options);
  try {
    app.world!.ownerChange(
      {
        version: 1,
        batch_id: id(),
        changes: [
          {
            intent: "ASSERT",
            subject: "role:master",
            predicate: "preference.statement",
            topic: "work",
            value: "Works late at night",
            valid_from: "2020-01-01T00:00:00.000Z",
            valid_to: "2021-01-01T00:00:00.000Z",
            fresh_until: "2020-06-01T00:00:00.000Z",
          },
        ],
      },
      scope(app),
    );
    const fact = app.store.all<WorldAssertion>("WorldAssertion")[0];
    app.world!.ownerChange(
      {
        version: 1,
        batch_id: id(),
        changes: [
          {
            intent: "RETRACT",
            subject: "role:master",
            predicate: "preference.statement",
            target_fact_id: fact.id,
          },
        ],
      },
      scope(app),
    );
    const snapshot = worldSnapshot(app.store, "2020-02-01T00:00:00.000Z");
    const result = recall(
      snapshot,
      "Master late night",
      { history: true },
      "2022-01-01T00:00:00.000Z",
    );
    assert.match(result.text, /RETRACTED/);
    assert.match(result.text, /2020-01-01/);
    assert.match(result.text, /2021-01-01/);
    assert.equal(result.hits[0].status, "RETRACTED");
    assert.equal(result.hits[0].stale, true);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("R5 idle World drains never read historical decision payloads", async () => {
  const dir = temp();
  const app = await App.open(dir, options);
  try {
    for (let i = 0; i < 100; i++)
      app.store.commit(
        [],
        [app.store.event("authorization.decided", { result: { id: id() } })],
      );
    const decisionPaths = new Set(
      app.store.events("authorization.decided").map((e) => e.payload.path),
    );
    const read = app.store.read.bind(app.store);
    let reads = 0;
    app.store.read = ((ref: any) => {
      if (decisionPaths.has(ref.path)) reads++;
      return read(ref);
    }) as typeof app.store.read;
    await app.world!.drain();
    await app.world!.drain();
    assert.equal(reads, 0);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
