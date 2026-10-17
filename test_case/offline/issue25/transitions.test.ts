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
  hash,
  id,
  next,
  revise,
} from "../../../src/pi_secretary/src/store.ts";
import { scopeOf } from "../../../src/pi_secretary/src/scheduler.ts";
import type {
  Execution,
  Input,
  Operation,
  Session,
} from "../../../src/pi_secretary/src/contracts.ts";

const catalog = JSON.parse(
  fs.readFileSync(
    new URL("../../../src/state_machine/catalog.json", import.meta.url),
    "utf8",
  ),
).machines as Record<
  string,
  {
    states: string[];
    terminal: string[];
    transitions: { from: string; to: string }[];
  }
>;
type Managed = Execution | Operation | Input;

async function fixture(
  run: (store: Store, templates: Managed[]) => Promise<void>,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue25-transitions-"));
  const app = await App.open(dir, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  let store: Store | undefined;
  try {
    app.scheduler.propose("State gate fixture", id(), app.host.sessionID, {
      preconditions: [
        {
          condition_id: id(),
          kind: "RESOURCE_PRESENT",
          target: "absent",
          required_revision: null,
        },
      ],
    });
    app.scheduler.tick();
    await app.scheduler.idle();
    const execution = app.store.all<Execution>("Execution")[0];
    const operation = app.authorization.prepare(
      scopeOf(execution),
      "file.write",
      path.join(app.scheduler.rootFor(execution), "result.txt"),
      { path: "result.txt", content: "synthetic" },
    );
    const input: Input = {
      ...base(),
      schema_version: 1,
      record_type: "Input",
      session_id: app.host.sessionID,
      dedupe_key: id(),
      producer: "MASTER",
      state: "ACCEPTED",
      payload: app.store.put("synthetic", "text/plain"),
      loop_id: null,
      received_at: new Date().toISOString(),
      feedback_id: null,
    };
    // Keep every test snapshot schema-valid even when the state is terminal.
    const executionTemplate = {
      ...execution,
      ended_at: new Date().toISOString(),
      result_id: id(),
    };
    const operationTemplate = {
      ...operation,
      receipt: app.store.put({ synthetic: true }),
    };
    await app.close();
    store = await Store.open(dir);
    await run(store, [executionTemplate, operationTemplate, input]);
  } finally {
    await app.close();
    await store?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

for (const kind of ["Execution", "Operation", "Input"] as const) {
  test(`${kind}: every state pair, same-state update and first snapshot; rejected transactions are atomic`, () =>
    fixture(async (store, templates) => {
      const template = templates.find((r) => r.record_type === kind)!;
      const machine = catalog[kind];
      for (const from of machine.states)
        for (const to of machine.states) {
          // Creating an already-running historical snapshot is supported. Only updates are gated.
          const before = { ...template, ...base(), state: from } as Managed;
          store.commit([before]);
          const updated = revise(before, { state: to } as Partial<Managed>);
          const session = store.all<Session>("Session")[0];
          const request = id();
          const event = store.event("state-gate-probe", { from, to });
          const sequence = store.sequence,
            digest = store.digest;
          const eventSequence = store.eventSequence,
            logs = [...store.logs];
          const journal = fs.readFileSync(
            path.join(store.dir, "journal.jsonl"),
          );
          const states = store.all(kind);
          const commit = () =>
            store.commit([revise(session, {}), updated], [event], {
              request,
              hash: hash("probe"),
              value: before.id,
            });
          if (
            from === to ||
            machine.transitions.some((e) => e.from === from && e.to === to)
          ) {
            commit();
            assert.equal(
              store.get<Managed>(kind, before.id).state,
              to,
              `${kind} ${from} -> ${to}`,
            );
            assert.equal(store.hasReceipt(request), true);
          } else {
            assert.throws(
              commit,
              new RegExp(`INVALID_${kind.toUpperCase()}_TRANSITION`),
              `${kind} ${from} -> ${to}`,
            );
            assert.equal(store.sequence, sequence);
            assert.equal(store.digest, digest);
            assert.deepEqual(
              fs.readFileSync(path.join(store.dir, "journal.jsonl")),
              journal,
            );
            assert.deepEqual(store.get("Session", session.id), session);
            assert.deepEqual(store.all(kind), states);
            assert.equal(store.hasReceipt(request), false);
            assert.equal(store.eventSequence, eventSequence);
            assert.deepEqual(store.logs, logs);
            assert.equal(store.eventById(event.event_id), undefined);
            if (kind !== "Operation")
              assert(
                store
                  .indexed(kind, "state", [from])
                  .some((r) => r.id === before.id),
              );
          }
        }
      const sequence = store.sequence,
        digest = store.digest;
      await store.close();
      const reopened = await Store.open(store.dir);
      try {
        assert.equal(reopened.sequence, sequence);
        assert.equal(reopened.digest, digest);
      } finally {
        await reopened.close();
      }
    }));
}

test("terminal executions and operations cannot be resurrected, independent of catalog contents", () =>
  fixture(async (store, templates) => {
    for (const template of templates.filter((r) => r.record_type !== "Input")) {
      for (const state of ["SUCCEEDED", "FAILED", "CANCELLED"]) {
        const before = { ...template, ...base(), state } as
          Execution | Operation;
        store.commit([before]);
        const target =
          before.record_type === "Execution" ? "RUNNING" : "DISPATCHED";
        assert.throws(
          () =>
            store.commit([
              revise(before, { state: target } as Partial<typeof before>),
            ]),
          /INVALID_.*_TRANSITION/,
        );
      }
    }
  }));

test("replay rejects a correctly hashed journal carrying an illegal transition without repairing its tail", () =>
  fixture(async (store, templates) => {
    const template = templates[0] as Execution;
    const terminal: Execution = { ...template, ...base(), state: "SUCCEEDED" };
    store.commit([terminal]);
    store.commit([revise(terminal, {})]);
    const invalid = store.put(revise(terminal, { state: "RUNNING" }));
    await store.close();
    const journal = path.join(store.dir, "journal.jsonl");
    const frames = fs.readFileSync(journal, "utf8").trimEnd().split("\n");
    const last = JSON.parse(frames.at(-1)!);
    const txn = JSON.parse(Buffer.from(last.payload_b64, "base64").toString());
    txn.mutations[0].snapshot = invalid;
    const payload = JSON.stringify(txn);
    frames[frames.length - 1] = JSON.stringify({
      payload_b64: Buffer.from(payload).toString("base64"),
      sha256: hash(payload),
    });
    const bytes = frames.join("\n") + "\n";
    fs.writeFileSync(journal, bytes);
    await assert.rejects(Store.open(store.dir), /INVALID_EXECUTION_TRANSITION/);
    assert.equal(fs.readFileSync(journal, "utf8"), bytes);
  }));

test("Authorization next preserves event semantics; only four enforced or called machines remain", () => {
  assert.deepEqual(Object.keys(catalog).sort(), [
    "Authorization",
    "Execution",
    "Input",
    "Operation",
  ]);
  assert.equal(next("Authorization", "PENDING", "approve"), "APPROVED");
  assert.equal(next("Authorization", "APPROVED", "consume"), "CONSUMED");
  assert.throws(
    () => next("Authorization", "CONSUMED", "approve"),
    /INVALID_TRANSITION Authorization CONSUMED approve/,
  );
});
