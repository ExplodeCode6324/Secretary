import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeContext } from "@earendil-works/pi-ai";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  transportFailure,
  retryRuntime,
} from "../../../src/pi_secretary/src/model-retry.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { durableStream } from "../../../src/pi_secretary/src/transport.ts";
import { base, hash, id, revise } from "../../../src/pi_secretary/src/store.ts";
import type { ModelCall } from "../../../src/pi_secretary/src/contracts.ts";

test("invalid SDK status falls through to message HTTP code; finite status retains precedence", () => {
  for (const status of [
    undefined,
    null,
    NaN,
    Infinity,
    -Infinity,
    "invalid",
    "",
  ]) {
    assert.equal(
      transportFailure(Object.assign(Error("HTTP 529 upstream"), { status })),
      "TRANSIENT",
    );
    assert.equal(
      transportFailure(Object.assign(Error("HTTP 503"), { status })),
      "TRANSIENT",
    );
    assert.equal(
      transportFailure(Object.assign(Error("HTTP 401"), { status })),
      "PERMANENT",
    );
    assert.equal(
      transportFailure(Object.assign(Error("unknown failure"), { status })),
      "LOCAL",
    );
  }
  const error = Object.assign(Error("HTTP 529 upstream"), { status: 401 });
  assert.equal(transportFailure(error), "PERMANENT");
  assert.equal(transportFailure(error, NaN), "PERMANENT");
  assert.equal(transportFailure(error, 503), "TRANSIENT");
  assert.equal(transportFailure(error, 503, true), "CANCELLED");
});

test("SDK errors with undefined/null status consume the three bounded physical attempts", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue19-review-status-"));
  const app = await App.open(dir, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  try {
    let sends = 0;
    retryRuntime.set(app.store, { wait: async () => {} });
    const stream: StreamFn = () => {
      sends++;
      if (sends < 3)
        throw Object.assign(
          Error(sends === 1 ? "HTTP 529 upstream" : "HTTP 503"),
          { status: sends === 1 ? undefined : null },
        );
      return replyStream([{ type: "text", text: "done" }]);
    };
    await durableStream(
      app.store,
      stream,
      { session_id: app.host.sessionID, task_id: null, execution_id: null },
      id(),
      "MAIN",
    )(
      fixtureModel,
      normalizeContext({
        messages: [
          { role: "user", content: "synthetic request", timestamp: 0 },
        ],
      }),
    );
    assert.equal(sends, 3);
    assert.deepEqual(
      app.store
        .all<ModelCall>("ModelCall")
        .map((c) => [c.transport_attempt, c.failure_kind ?? null]),
      [
        [1, "TRANSIENT"],
        [2, "TRANSIENT"],
        [3, null],
      ],
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("logical-key lookup isolates history, preserves attempt order and rebuilds on replay", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue19-review-index-"));
  let app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
  try {
    const context = normalizeContext({
      messages: [{ role: "user", content: "synthetic request", timestamp: 0 }],
    });
    const scope = {
        session_id: app.host.sessionID,
        task_id: null,
        execution_id: null,
      },
      loop = id();
    let sends = 0;
    const stream: StreamFn = () => {
      sends++;
      return replyStream([{ type: "text", text: "saved result" }]);
    };
    await durableStream(
      app.store,
      stream,
      scope,
      loop,
      "MAIN",
    )(fixtureModel, context);
    const seed = app.store.all<ModelCall>("ModelCall")[0];
    const second = { ...seed, ...base(), transport_attempt: 2 },
      third = { ...seed, ...base(), transport_attempt: 3 };
    const legacy: ModelCall = { ...seed, ...base(), logical_key: undefined };
    app.store.commit([
      ...Array.from({ length: 512 }, (_, i) => ({
        ...seed,
        ...base(),
        logical_key: hash(`unrelated-${i}`),
      })),
      second,
      third,
      legacy,
    ]);
    const updated = revise(seed, { error: "earlier attempt metadata" });
    app.store.commit([updated]);
    // Updating an earlier attempt must not make it the newest attempt.
    const check = () => {
      const calls = app.store.modelCallsFor(seed.logical_key!);
      assert.deepEqual(
        calls.map((c) => c.id),
        [seed.id, second.id, third.id],
      );
      assert.equal(calls[0].error, updated.error);
      calls[0].scope.session_id = null;
      calls.pop();
      assert.deepEqual(
        app.store.modelCallsFor(seed.logical_key!).map((c) => c.id),
        [seed.id, second.id, third.id],
      );
      assert.equal(
        app.store.modelCallsFor(seed.logical_key!)[0].scope.session_id,
        scope.session_id,
      );
      assert.deepEqual(app.store.modelCallsFor(hash("missing")), []);
    };
    check();
    assert.throws(
      () => app.store.commit([{ ...third, error: "uncommitted" }]),
      /REVISION_CONFLICT/,
    );
    check();
    await app.close();
    app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
    check();
    assert.equal(
      app.store.get<ModelCall>("ModelCall", legacy.id).logical_key,
      undefined,
    );
    const added = revise(legacy, { logical_key: hash("upgraded-legacy") });
    app.store.commit([added]);
    assert.deepEqual(
      app.store.modelCallsFor(added.logical_key!).map((c) => c.id),
      [legacy.id],
    );
    const moved = revise(added, { logical_key: hash("moved-legacy") });
    app.store.commit([moved]);
    assert.deepEqual(app.store.modelCallsFor(added.logical_key!), []);
    assert.deepEqual(
      app.store.modelCallsFor(moved.logical_key!).map((c) => c.id),
      [legacy.id],
    );
    app.store.commit([revise(moved, { logical_key: undefined })]);
    assert.deepEqual(app.store.modelCallsFor(moved.logical_key!), []);
    const all = app.store.all.bind(app.store),
      select = app.store.select.bind(app.store);
    app.store.all = (() => {
      throw Error("unbounded all query");
    }) as typeof app.store.all;
    app.store.select = (() => {
      throw Error("linear select query");
    }) as typeof app.store.select;
    try {
      await durableStream(
        app.store,
        stream,
        scope,
        loop,
        "MAIN",
      )(fixtureModel, context);
      assert.equal(
        sends,
        1,
        "saved success must be reused without a full-history query",
      );
    } finally {
      app.store.all = all;
      app.store.select = select;
    }
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
