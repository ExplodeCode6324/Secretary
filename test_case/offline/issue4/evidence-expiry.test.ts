import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { App } from "../../../src/pi_secretary/src/app.ts";
import type {
  Context,
  ExtractionRecovery,
  ModelCall,
  RecoveryBinding,
} from "../../../src/pi_secretary/src/contracts.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
} from "../../../src/pi_secretary/src/model.ts";
import { extractNewCommitments } from "../../../src/pi_secretary/src/memory-extraction.ts";
import {
  listExtractionRecoveryGroups,
  recoverExtractionOnce,
} from "../../../src/pi_secretary/src/memory-extraction-recovery.ts";
import { base, hash, id, revise } from "../../../src/pi_secretary/src/store.ts";

const good = (model: typeof fixtureModel) =>
  replyStream([{ type: "text", text: '{"quotes":[]}' }], model);
const bad = (model: typeof fixtureModel) =>
  replyStream([{ type: "text", text: "invalid" }], model);
async function fixture(
  body: (f: {
    app: () => App;
    opts: () => {
      store: App["store"];
      model: typeof fixtureModel;
      sessionID: string;
      consciousnessRevision: number;
    };
    extract: (valid?: boolean) => Promise<string[]>;
    reopen: () => Promise<void>;
  }) => Promise<void>,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue4-evidence-expiry-"));
  let app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
  const sessionID = app.host.sessionID;
  const source = [
    { id: id(), role: "assistant" as const, text: "I will report tomorrow." },
  ];
  const loopID = id();
  const opts = () => ({
    store: app.store,
    model: fixtureModel,
    sessionID,
    consciousnessRevision: 1,
  });
  try {
    await body({
      app: () => app,
      opts,
      extract: (valid = true) =>
        extractNewCommitments({
          ...opts(),
          source,
          completeMessages: source,
          existing: [],
          loopID,
          stream: valid ? good : bad,
        }),
      reopen: async () => {
        await app.close();
        app = await App.open(dir, {
          model: fixtureModel,
          stream: fixtureStream,
        });
      },
    });
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Conditional persisted-record damage from PERRI's audit; no public UI exploit is claimed.
for (const kind of ["task_scope", "missing_context", "wrong_system"] as const)
  test(`PERRI persisted evidence fails closed: ${kind}`, async () =>
    fixture(async (f) => {
      await f.extract();
      const app = f.app(),
        call = app.store.all<ModelCall>("ModelCall")[0];
      const prior = listExtractionRecoveryGroups(f.opts())[0];
      if (kind === "task_scope")
        app.store.commit([
          revise(call, {
            scope: { ...call.scope, task_id: id(), execution_id: id() },
          }),
        ]);
      if (kind === "missing_context")
        app.store.commit([revise(call, { context_id: id() })]);
      if (kind === "wrong_system") {
        const request = app.store.read<{ messages: { content: unknown }[] }>(
          call.request,
        );
        request.messages[0].content = [{ type: "text", text: "WRONG SYSTEM" }];
        app.store.commit([revise(call, { request: app.store.put(request) })]);
      }
      const sequence = app.store.sequence;
      assert.equal(listExtractionRecoveryGroups(f.opts())[0].status, "BLOCKED");
      let sends = 0;
      await assert.rejects(
        recoverExtractionOnce({
          ...f.opts(),
          request: { request_id: id(), ...prior.binding! },
          stream: (m) => {
            sends++;
            return good(m);
          },
        }),
        /BLOCKED|BINDING_MISMATCH/,
      );
      assert.equal(sends, 0);
      assert.equal(app.store.sequence, sequence);
    }));

const TTL = 300000;
function withoutTicket(binding: RecoveryBinding) {
  const { authorization_id, issued_at, expires_at, ...old } = binding;
  return old;
}
for (const damage of [
  "loop",
  "purpose",
  "revision",
  "model",
  "duplicate",
  "raw_context",
  "tools",
] as const)
  test(`Context association rejects persisted ${damage} substitution`, async () =>
    fixture(async (f) => {
      await f.extract();
      const store = f.app().store,
        call = store.all<ModelCall>("ModelCall")[0];
      const context = store.get<Context>("Context", call.context_id);
      const changed: Context = {
        ...context,
        ...base(),
        ...(damage === "loop" ? { loop_id: id() } : {}),
        ...(damage === "purpose" ? { purpose: "MAIN" } : {}),
        ...(damage === "revision" ? { consciousness_revision: 2 } : {}),
        ...(damage === "model" ? { provider_profile: "different-model" } : {}),
        ...(damage === "raw_context" ? { raw_context: store.put([]) } : {}),
        ...(damage === "tools" ? { tools_schema: store.put([]) } : {}),
      };
      store.commit(
        [changed, revise(call, { context_id: changed.id })],
        [store.event("model.context", changed, call.scope)],
      );
      assert.equal(listExtractionRecoveryGroups(f.opts())[0].status, "BLOCKED");
    }));

test("provider response model aliases preserve exact successful-call reconciliation", async () =>
  fixture(async (f) => {
    await f.extract();
    const store = f.app().store,
      call = store.all<ModelCall>("ModelCall")[0];
    store.commit([
      revise(call, {
        response: store.put({
          ...store.read<object>(call.response!),
          model: "provider-normalized-alias",
          provider: "provider-label",
        }),
      }),
    ]);
    const view = listExtractionRecoveryGroups(f.opts())[0];
    assert.equal(view.status, "SUCCEEDED");
    const recovered = await recoverExtractionOnce({
      ...f.opts(),
      request: { request_id: id(), ...view.binding! },
      stream: () => {
        throw Error("must not send");
      },
    });
    assert.equal(recovered.status, "SUCCEEDED");
    assert.equal(
      store.get<ExtractionRecovery>("ExtractionRecovery", recovered.recovery_id)
        .call_id,
      call.id,
    );
  }));

test("preflight tickets are stable, detached, read-only and exactly five minutes", async () =>
  fixture(async (f) => {
    await assert.rejects(f.extract(false));
    const before = f.app().store.sequence;
    const first = listExtractionRecoveryGroups(f.opts())[0].binding!;
    assert.ok(first.authorization_id);
    assert.equal(
      Date.parse(first.expires_at!) - Date.parse(first.issued_at!),
      TTL,
    );
    assert.deepEqual(listExtractionRecoveryGroups(f.opts())[0].binding, first);
    const original = { ...first };
    first.expires_at = new Date(
      Date.parse(first.expires_at!) + TTL,
    ).toISOString();
    assert.deepEqual(
      listExtractionRecoveryGroups(f.opts())[0].binding,
      original,
    );
    assert.equal(f.app().store.sequence, before);
  }));

for (const mode of ["deadline", "future", "backward", "monotonic"] as const)
  test(`unchanged state cannot authorize after ${mode} clock boundary`, async (t) =>
    fixture(async (f) => {
      await assert.rejects(f.extract(false));
      const binding = listExtractionRecoveryGroups(f.opts())[0].binding!;
      const sequence = f.app().store.sequence;
      let wall = Date.parse(binding.issued_at!),
        mono = performance.now();
      t.mock.method(Date, "now", () => wall);
      t.mock.method(performance, "now", () => mono);
      if (mode === "deadline") wall += TTL;
      if (mode === "future") wall += TTL * 100;
      if (mode === "backward") wall -= 1;
      if (mode === "monotonic") mono += TTL;
      let sends = 0;
      const stream = (m: typeof fixtureModel) => {
        sends++;
        return good(m);
      };
      await assert.rejects(
        recoverExtractionOnce({
          ...f.opts(),
          request: { request_id: id(), ...binding },
          stream,
        }),
        /AUTHORIZATION_EXPIRED/,
      );
      assert.equal(f.app().store.sequence, sequence);
      assert.equal(sends, 0);
      // A fresh preflight authorizes this still-current failed group, not its old timestamp.
      const fresh = listExtractionRecoveryGroups(f.opts())[0].binding!;
      assert.notEqual(fresh.authorization_id, binding.authorization_id);
      const request = { request_id: id(), ...fresh };
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          recoverExtractionOnce({ ...f.opts(), request, stream }),
        ),
      );
      assert.equal(sends, 1);
      assert.ok(results.every((r) => r.recovery_id === results[0].recovery_id));
    }));

test("caller cannot extend, replace, partially omit or invent authorization fields", async () =>
  fixture(async (f) => {
    await assert.rejects(f.extract(false));
    const binding = listExtractionRecoveryGroups(f.opts())[0].binding!;
    const sequence = f.app().store.sequence;
    for (const changed of [
      {
        ...binding,
        expires_at: new Date(
          Date.parse(binding.expires_at!) + TTL,
        ).toISOString(),
      },
      {
        ...binding,
        issued_at: new Date(Date.parse(binding.issued_at!) + TTL).toISOString(),
      },
      { ...binding, authorization_id: id() },
      withoutTicket(binding),
      { ...withoutTicket(binding), authorization_id: binding.authorization_id },
    ])
      await assert.rejects(
        recoverExtractionOnce({
          ...f.opts(),
          request: { request_id: id(), ...changed },
          stream: () => {
            throw Error("must not send");
          },
        }),
        /AUTHORIZATION_BINDING_MISMATCH/,
      );
    assert.equal(f.app().store.sequence, sequence);
  }));

test("unconsumed ticket fails after restart; refreshed ticket sends once", async () =>
  fixture(async (f) => {
    await assert.rejects(f.extract(false));
    const binding = listExtractionRecoveryGroups(f.opts())[0].binding!;
    const request = { request_id: id(), ...binding };
    await f.reopen();
    const sequence = f.app().store.sequence;
    await assert.rejects(
      recoverExtractionOnce({
        ...f.opts(),
        request,
        stream: () => {
          throw Error("must not send");
        },
      }),
      /AUTHORIZATION_BINDING_MISMATCH/,
    );
    assert.equal(f.app().store.sequence, sequence);
    const fresh = listExtractionRecoveryGroups(f.opts())[0].binding!;
    assert.notEqual(fresh.authorization_id, binding.authorization_id);
    let sends = 0;
    const result = await recoverExtractionOnce({
      ...f.opts(),
      request: { request_id: id(), ...fresh },
      stream: (m) => {
        sends++;
        return good(m);
      },
    });
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(sends, 1);
  }));

test("consumed canonical receipt replays after expiry/restart; ticket edits conflict", async (t) =>
  fixture(async (f) => {
    await assert.rejects(f.extract(false));
    const request = {
      request_id: id(),
      ...listExtractionRecoveryGroups(f.opts())[0].binding!,
    };
    let sends = 0;
    const stream = (m: typeof fixtureModel) => {
      sends++;
      return good(m);
    };
    const first = await recoverExtractionOnce({ ...f.opts(), request, stream });
    t.mock.method(Date, "now", () => Date.parse(request.expires_at!) + TTL);
    assert.deepEqual(
      await recoverExtractionOnce({ ...f.opts(), request, stream }),
      first,
    );
    await f.reopen();
    const reordered = Object.fromEntries(
      Object.entries(request).reverse(),
    ) as typeof request;
    assert.deepEqual(
      await recoverExtractionOnce({ ...f.opts(), request: reordered, stream }),
      first,
    );
    for (const changed of [
      { ...request, authorization_id: id() },
      {
        ...request,
        issued_at: new Date(Date.parse(request.issued_at!) + 1).toISOString(),
      },
      {
        ...request,
        expires_at: new Date(Date.parse(request.expires_at!) + 1).toISOString(),
      },
      { request_id: request.request_id, ...withoutTicket(request) },
    ])
      await assert.rejects(
        recoverExtractionOnce({ ...f.opts(), request: changed, stream }),
        /REQUEST_CONFLICT/,
      );
    assert.equal(sends, 1);
  }));

test("consumed saved response reconciles after expiry/restart without a new send", async (t) =>
  fixture(async (f) => {
    await assert.rejects(f.extract(false));
    const request = {
      request_id: id(),
      ...listExtractionRecoveryGroups(f.opts())[0].binding!,
    };
    const store = f.app().store,
      commit = store.commit.bind(store);
    let sends = 0;
    const stream = (m: typeof fixtureModel) => {
      sends++;
      return good(m);
    };
    store.commit = (records, events = [], receipt) => {
      if (
        events.some((e) =>
          ["memory.extraction.succeeded", "memory.extraction.failed"].includes(
            e.event_type,
          ),
        )
      )
        throw Error("synthetic result-commit interruption");
      return commit(records, events, receipt);
    };
    try {
      await assert.rejects(
        recoverExtractionOnce({ ...f.opts(), request, stream }),
        /synthetic result-commit interruption/,
      );
    } finally {
      store.commit = commit;
    }
    assert.equal(
      store.all<ExtractionRecovery>("ExtractionRecovery")[0].state,
      "CLAIMED",
    );
    t.mock.method(Date, "now", () => Date.parse(request.expires_at!) + TTL);
    await f.reopen();
    assert.equal(
      (await recoverExtractionOnce({ ...f.opts(), request, stream })).status,
      "SUCCEEDED",
    );
    assert.equal(sends, 1);
  }));

test("legacy v1 no-ticket receipt retains its original hash and replays after restart", async () =>
  fixture(async (f) => {
    await f.extract();
    const store = f.app().store,
      binding = withoutTicket(
        listExtractionRecoveryGroups(f.opts())[0].binding!,
      );
    const request = { request_id: id(), ...binding };
    const requestHash = hash(
      JSON.stringify({ session_id: f.opts().sessionID, request }),
    );
    const record: ExtractionRecovery = {
      schema_version: 1,
      record_type: "ExtractionRecovery",
      ...base(),
      session_id: f.opts().sessionID,
      group_key: binding.group_key,
      attempt_id: id(),
      parent_attempt_id: binding.attempt_id,
      request_id: request.request_id,
      request_hash: requestHash,
      binding_ref: store.put(binding),
      binding_snapshot: binding,
      request_snapshot: request,
      generation: 1,
      owner_epoch: store.epoch,
      state: "SUCCEEDED",
      call_id: binding.model_call_id,
      quotes: [],
      error: null,
    };
    store.commit([record], [], {
      request: request.request_id,
      hash: requestHash,
      value: record.id,
    });
    await f.reopen();
    const result = await recoverExtractionOnce({
      ...f.opts(),
      request,
      stream: () => {
        throw Error("must not send");
      },
    });
    assert.equal(result.recovery_id, record.id);
    assert.equal(result.status, "SUCCEEDED");
  }));

for (const messages of [null, [null, null], [{ role: "system" }]])
  test(`malformed persisted request blocks without sending: ${JSON.stringify(messages)}`, async () =>
    fixture(async (f) => {
      await f.extract();
      const store = f.app().store,
        call = store.all<ModelCall>("ModelCall")[0];
      const binding = listExtractionRecoveryGroups(f.opts())[0].binding!;
      store.commit([revise(call, { request: store.put({ messages }) })]);
      assert.equal(listExtractionRecoveryGroups(f.opts())[0].status, "BLOCKED");
      await assert.rejects(
        recoverExtractionOnce({
          ...f.opts(),
          request: { request_id: id(), ...binding },
          stream: () => {
            throw Error("must not send");
          },
        }),
        /BLOCKED|BINDING_MISMATCH/,
      );
    }));
