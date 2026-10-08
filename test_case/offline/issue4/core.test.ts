import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtractionRecovery } from "../../../src/pi_secretary/src/contracts.ts";
import { App } from "../../../src/pi_secretary/src/app.ts";
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
import { id, base, revise } from "../../../src/pi_secretary/src/store.ts";

test("explicit recovery sends once; simultaneous replay returns same receipt; ordinary extraction remains blocked", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue4-core-"));
  const app = await App.open(dir, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  const opts = {
    store: app.store,
    model: fixtureModel,
    sessionID: app.host.sessionID,
    consciousnessRevision: 1,
  };
  let calls = 0;
  try {
    const source = [
      {
        id: id(),
        role: "assistant" as const,
        text: "I will review it tomorrow.",
      },
    ];
    const extraction = {
      ...opts,
      loopID: id(),
      source: null,
      completeMessages: source,
      existing: [],
    };
    await assert.rejects(
      extractNewCommitments({
        ...extraction,
        stream: (model) => {
          calls++;
          return replyStream([{ type: "text", text: "invalid" }], model);
        },
      }),
    );
    await assert.rejects(
      extractNewCommitments({ ...extraction, stream: fixtureStream }),
      /REPLAY_BLOCKED/,
    );
    const groups = listExtractionRecoveryGroups(opts);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].status, "READY");
    const request = { request_id: id(), ...groups[0].binding! };
    const recover = () =>
      recoverExtractionOnce({
        ...opts,
        request,
        stream: (model) => {
          calls++;
          return replyStream(
            [
              {
                type: "text",
                text: JSON.stringify({ quotes: [source[0].text] }),
              },
            ],
            model,
          );
        },
      });
    const [a, b] = await Promise.all([recover(), recover()]);
    assert.equal(a.recovery_id, b.recovery_id);
    assert.equal(calls, 2);
    assert.equal((await recover()).status, "SUCCEEDED");
    assert.equal(calls, 2);
    assert.deepEqual(
      await extractNewCommitments({ ...extraction, stream: fixtureStream }),
      [source[0].text],
    );
    await assert.rejects(
      recoverExtractionOnce({
        ...opts,
        request: { ...request, source_hash: "f".repeat(64) },
        stream: fixtureStream,
      }),
      /REQUEST_CONFLICT/,
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("preflight is read-only and each binding field is authoritative", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue4-bind-"));
  const app = await App.open(dir, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  const opts = {
    store: app.store,
    model: fixtureModel,
    sessionID: app.host.sessionID,
    consciousnessRevision: 1,
  };
  try {
    await assert.rejects(
      extractNewCommitments({
        ...opts,
        loopID: id(),
        source: [
          { id: id(), role: "assistant", text: "I will test tomorrow." },
        ],
        existing: [],
        stream: (model) => replyStream([{ type: "text", text: "bad" }], model),
      }),
    );
    const before = app.store.sequence;
    const view = listExtractionRecoveryGroups(opts)[0];
    assert.equal(view.status, "READY");
    assert.equal(app.store.sequence, before);
    const binding = view.binding!;
    assert.ok(binding.model_call_id);
    assert.ok(binding.model_request_hash);
    for (const [field, value] of Object.entries({
      group_key: "a".repeat(64),
      attempt_id: id(),
      expected_revision: 2,
      policy: "other",
      implementation_version: "next",
      config_hash: "a".repeat(64),
      source_hash: "a".repeat(64),
      model_call_id: id(),
      model_request_hash: "a".repeat(64),
      actual_payload_hash: "a".repeat(64),
    })) {
      await assert.rejects(
        recoverExtractionOnce({
          ...opts,
          request: { request_id: id(), ...binding, [field]: value },
          stream: () => {
            throw Error("must not send");
          },
        }),
        /BINDING_MISMATCH/,
      );
    }
    assert.equal(app.store.sequence, before);
    assert.equal(
      listExtractionRecoveryGroups({ ...opts, consciousnessRevision: 2 })[0]
        .status,
      "BLOCKED",
    );
    assert.equal(
      listExtractionRecoveryGroups({
        ...opts,
        model: { ...fixtureModel, maxTokens: 1234 },
      })[0].status,
      "BLOCKED",
    );
    await assert.rejects(
      recoverExtractionOnce({
        ...opts,
        sessionID: id(),
        request: { request_id: id(), ...binding },
        stream: fixtureStream,
      }),
      /BINDING_MISMATCH/,
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("recoveryOnly never dispatches even a previously unseen source", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue4-only-"));
  const app = await App.open(dir, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  try {
    const before = app.store.sequence;
    await assert.rejects(
      extractNewCommitments({
        store: app.store,
        model: fixtureModel,
        stream: () => {
          throw Error("must not send");
        },
        sessionID: app.host.sessionID,
        consciousnessRevision: 1,
        loopID: id(),
        source: [
          { id: id(), role: "assistant", text: "I will test tomorrow." },
        ],
        existing: [],
        recoveryOnly: true,
      }),
      /RECOVERY_ONLY_BLOCKED/,
    );
    assert.equal(app.store.sequence, before);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Store enforces immutable recovery identity, generation CAS and one source claim", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue4-store-"));
  const app = await App.open(dir, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  const opts = {
    store: app.store,
    model: fixtureModel,
    sessionID: app.host.sessionID,
    consciousnessRevision: 1,
  };
  try {
    await assert.rejects(
      extractNewCommitments({
        ...opts,
        loopID: id(),
        source: [],
        existing: [],
        stream: (model) => replyStream([{ type: "text", text: "bad" }], model),
      }),
    );
    const binding = listExtractionRecoveryGroups(opts)[0].binding!;
    const result = await recoverExtractionOnce({
      ...opts,
      request: { request_id: id(), ...binding },
      stream: (model) =>
        replyStream([{ type: "text", text: '{"quotes":[]}' }], model),
    });
    const done = app.store.get<ExtractionRecovery>(
      "ExtractionRecovery",
      result.recovery_id,
    );
    assert.throws(
      () => app.store.commit([revise(done, { state: "CLAIMED" })]),
      /TERMINAL_IMMUTABLE/,
    );
    const claim: ExtractionRecovery = {
      ...done,
      ...base(),
      generation: 2,
      state: "CLAIMED",
      request_id: id(),
      attempt_id: id(),
      call_id: null,
    };
    app.store.commit([claim]);
    assert.throws(
      () => app.store.commit([revise(claim, { group_key: "a".repeat(64) })]),
      /IDENTITY_CHANGED/,
    );
    assert.throws(
      () => app.store.commit([{ ...claim, ...base(), generation: 3 }]),
      /SOURCE_CLAIMED/,
    );
    assert.throws(
      () =>
        app.store.commit([
          { ...claim, ...base(), generation: 2, state: "SUCCEEDED" },
        ]),
      /GENERATION_CONFLICT/,
    );
    const linked = revise(claim, { call_id: id() });
    app.store.commit([linked]);
    assert.throws(
      () => app.store.commit([revise(linked, { call_id: id() })]),
      /CALL_CHANGED/,
    );
    app.store.commit([revise(linked, { state: "SUCCEEDED" })]);
    assert.throws(
      () => app.store.commit([{ ...claim, ...base(), generation: 4 }]),
      /GENERATION_CONFLICT/,
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("saved extraction success cannot authorize a new recovery across model config changes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue4-success-config-"));
  const app = await App.open(dir, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  const opts = {
    store: app.store,
    model: fixtureModel,
    sessionID: app.host.sessionID,
    consciousnessRevision: 1,
  };
  try {
    await extractNewCommitments({
      ...opts,
      loopID: id(),
      source: [],
      existing: [],
      stream: (model) =>
        replyStream([{ type: "text", text: '{"quotes":[]}' }], model),
    });
    const original = listExtractionRecoveryGroups(opts)[0];
    assert.equal(original.status, "SUCCEEDED");
    const variants = [
      { ...fixtureModel, maxTokens: fixtureModel.maxTokens - 1 },
      { ...fixtureModel, compat: { supportsDeveloperRole: false } },
      { ...fixtureModel, reasoning: !fixtureModel.reasoning },
      { ...fixtureModel, input: ["text", "image"] as ("text" | "image")[] },
      { ...fixtureModel, inputLimits: { maxRequestBytes: 50000 } },
      { ...fixtureModel, thinkingLevelMap: { high: "high" } },
      { ...fixtureModel, promptCache: { short: 300 } },
      { ...fixtureModel, samplingParams: { temperature: 0.25 } },
    ];
    for (const model of variants) {
      const changed = { ...opts, model };
      const before = app.store.sequence;
      const view = listExtractionRecoveryGroups(changed)[0];
      assert.equal(view.status, "BLOCKED", JSON.stringify(model));
      assert.equal(view.reason, "CONFIG_CHANGED");
      await assert.rejects(
        recoverExtractionOnce({
          ...changed,
          request: { request_id: id(), ...original.binding! },
          stream: () => {
            throw Error("must not send");
          },
        }),
        /RECOVERY_BLOCKED|BINDING_MISMATCH/,
      );
      assert.equal(app.store.sequence, before);
    }
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ordinary success first reconciliation retains exact ModelCall binding and aliases preserve it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue4-success-call-"));
  const app = await App.open(dir, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  const opts = {
    store: app.store,
    model: fixtureModel,
    sessionID: app.host.sessionID,
    consciousnessRevision: 1,
  };
  try {
    await extractNewCommitments({
      ...opts,
      loopID: id(),
      source: [],
      existing: [],
      stream: (model) =>
        replyStream([{ type: "text", text: '{"quotes":[]}' }], model),
    });
    const call =
      app.store.all<
        import("../../../src/pi_secretary/src/contracts.ts").ModelCall
      >("ModelCall")[0];
    const payload = app.store.put({ synthetic_provider_payload: true });
    app.store.commit(
      [],
      [
        app.store.event(
          "model.payload",
          {
            call_id: call.id,
            context_id: call.context_id,
            payload_ref: payload,
          },
          call.scope,
        ),
      ],
    );
    const group = listExtractionRecoveryGroups(opts)[0];
    assert.equal(group.status, "SUCCEEDED");
    assert.equal(group.binding!.model_call_id, call.id);
    assert.equal(group.binding!.model_request_hash, call.request.sha256);
    assert.equal(group.binding!.actual_payload_hash, payload.sha256);
    const request = { request_id: id(), ...group.binding! };
    let sends = 0;
    const stream = () => {
      sends++;
      throw Error("must not send");
    };
    const first = await recoverExtractionOnce({ ...opts, request, stream });
    const recovery = app.store.get<ExtractionRecovery>(
      "ExtractionRecovery",
      first.recovery_id,
    );
    assert.equal(recovery.call_id, call.id);
    assert.equal(recovery.binding_snapshot.model_call_id, call.id);
    assert.equal(
      recovery.binding_snapshot.model_request_hash,
      call.request.sha256,
    );
    assert.equal(recovery.binding_snapshot.actual_payload_hash, payload.sha256);
    const latest = listExtractionRecoveryGroups({
      ...opts,
      consciousnessRevision: 2,
    })[0];
    assert.equal(
      latest.status,
      "SUCCEEDED",
      "a committed result keeps the revision exception",
    );
    assert.equal(latest.binding!.model_call_id, call.id);
    const alias = await recoverExtractionOnce({
      ...opts,
      request: { request_id: id(), ...latest.binding! },
      stream,
    });
    assert.equal(alias.recovery_id, first.recovery_id);
    assert.equal(app.store.all("ExtractionRecovery").length, 1);
    assert.equal(
      (
        await recoverExtractionOnce({
          ...opts,
          model: { ...fixtureModel, maxTokens: 99 },
          request,
          stream,
        })
      ).recovery_id,
      first.recovery_id,
      "existing completed receipt remains directly readable",
    );
    assert.equal(sends, 0);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const invalid of [
  "scope",
  "request",
  "response",
  "error",
  "aborted",
] as const)
  test(`ordinary saved success with invalid ${invalid} call evidence stays BLOCKED`, async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "issue4-bad-success-call-"),
    );
    const app = await App.open(dir, {
      model: fixtureModel,
      stream: fixtureStream,
    });
    const opts = {
      store: app.store,
      model: fixtureModel,
      sessionID: app.host.sessionID,
      consciousnessRevision: 1,
    };
    try {
      await extractNewCommitments({
        ...opts,
        loopID: id(),
        source: [],
        existing: [],
        stream: (model) =>
          replyStream([{ type: "text", text: '{"quotes":[]}' }], model),
      });
      const call =
        app.store.all<
          import("../../../src/pi_secretary/src/contracts.ts").ModelCall
        >("ModelCall")[0];
      const before = listExtractionRecoveryGroups(opts)[0];
      app.store.commit([
        revise(
          call,
          invalid === "scope"
            ? { scope: { ...call.scope, session_id: id() } }
            : invalid === "request"
              ? { request: app.store.put({ messages: [] }) }
              : invalid === "response"
                ? { response: null }
                : {
                    response: app.store.put({
                      ...app.store.read<object>(call.response!),
                      stopReason: invalid,
                      errorMessage: "synthetic provider unknown outcome",
                    }),
                  },
        ),
      ]);
      const view = listExtractionRecoveryGroups(opts)[0];
      assert.equal(view.status, "BLOCKED");
      const seq = app.store.sequence;
      await assert.rejects(
        recoverExtractionOnce({
          ...opts,
          request: { request_id: id(), ...(view.binding ?? before.binding)! },
          stream: () => {
            throw Error("must not send");
          },
        }),
        /BLOCKED|BINDING_MISMATCH/,
      );
      assert.equal(app.store.sequence, seq);
    } finally {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

test("ordinary saved success without an exact call_linked event remains BLOCKED", async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "issue4-success-missing-link-"),
  );
  const app = await App.open(dir, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  const opts = {
    store: app.store,
    model: fixtureModel,
    sessionID: app.host.sessionID,
    consciousnessRevision: 1,
  };
  const commit = app.store.commit.bind(app.store);
  try {
    app.store.commit = (records, events = [], receipt) =>
      commit(
        records,
        events.filter((e) => e.event_type !== "memory.extraction.call_linked"),
        receipt,
      );
    await extractNewCommitments({
      ...opts,
      loopID: id(),
      source: [],
      existing: [],
      stream: (model) =>
        replyStream([{ type: "text", text: '{"quotes":[]}' }], model),
    });
    app.store.commit = commit;
    const view = listExtractionRecoveryGroups(opts)[0];
    assert.equal(view.status, "BLOCKED");
    assert.equal(view.reason, "SUCCESS_MISSING_EXACT_MODEL_CALL");
    await assert.rejects(
      recoverExtractionOnce({
        ...opts,
        request: { request_id: id(), ...view.binding! },
        stream: () => {
          throw Error("must not send");
        },
      }),
      /BLOCKED/,
    );
  } finally {
    app.store.commit = commit;
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
