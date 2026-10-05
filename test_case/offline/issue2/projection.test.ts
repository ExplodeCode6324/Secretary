import { getModel } from "@earendil-works/pi-ai/compat";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentText, normalizeContext } from "@earendil-works/pi-ai";
import { Store, base, id, now } from "../../../src/pi_secretary/src/store.ts";
import { saveContext } from "../../../src/pi_secretary/src/context.ts";
import {
  WORKING_MEMORY_PREFIX,
  buildCompaction,
  projectContext,
} from "../../../src/pi_secretary/src/context-projection.ts";
import {
  budgetConfig,
  requestBudget,
} from "../../../src/pi_secretary/src/budget.ts";
import {
  Agent,
  fixtureModel,
  roleModel,
} from "../../../src/pi_secretary/src/model.ts";
import type { AgentMessage } from "../../../src/pi_secretary/src/model.ts";
import type {
  Consciousness,
  Input,
  ObjectRef,
  Session,
} from "../../../src/pi_secretary/src/contracts.ts";

// The whole suite is synthetic: isolated Store per test, no database, no
// provider, no network. Budget math uses the real requestBudget meter on a
// 32KiB window so threshold/target behavior is exercised end to end.
const model = { ...fixtureModel, contextWindow: 32_768 };

function usage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}
function systemMessage(text: string): AgentMessage {
  return { role: "system", content: text, timestamp: 0 };
}
function userMessage(text: string, timestamp = 1): AgentMessage {
  return { role: "user", content: text, timestamp };
}
function assistantMessage(text: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: fixtureModel.api,
    provider: fixtureModel.provider,
    model: fixtureModel.id,
    usage: usage(),
    stopReason: "stop",
    timestamp: 2,
  };
}
function toolCallMessage(callID: string, name: string): AgentMessage {
  return {
    role: "assistant",
    content: [
      { type: "toolCall", id: callID, name, arguments: { query: "x" } },
    ],
    api: fixtureModel.api,
    provider: fixtureModel.provider,
    model: fixtureModel.id,
    usage: usage(),
    stopReason: "toolUse",
    timestamp: 3,
  };
}
function toolResultMessage(
  callID: string,
  name: string,
  text: string,
): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: callID,
    toolName: name,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 4,
  };
}
function flat(message: AgentMessage): string {
  switch (message.role) {
    case "system":
    case "user":
      return contentText(message.content);
    case "assistant":
    case "toolResult":
      return message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
    default:
      return "";
  }
}
function hasMarker(messages: AgentMessage[], marker: string): boolean {
  return messages.some((message) => flat(message).includes(marker));
}
function countText(messages: AgentMessage[], text: string): number {
  return messages.filter((message) => flat(message) === text).length;
}
function orphanedResults(messages: AgentMessage[]): boolean {
  const calls = new Set<string>();
  const results = new Set<string>();
  for (const message of messages) {
    if (message.role === "assistant")
      for (const part of message.content)
        if (part.type === "toolCall") calls.add(part.id);
    if (message.role === "toolResult") results.add(message.toolCallId);
  }
  for (const result of results) if (!calls.has(result)) return true;
  return false;
}
/** Count every CAS read so tests can prove stored bodies are not opened. */
function patchReads(store: Store): string[] {
  const reads: string[] = [];
  const originalRead = store.read;
  store.read = (<T>(ref: ObjectRef): T => {
    reads.push(ref.sha256);
    return originalRead.call(store, ref) as T;
  }) as Store["read"];
  return reads;
}

function seedSession(store: Store, sessionID: string) {
  const session: Session = {
    schema_version: 1,
    record_type: "Session",
    id: sessionID,
    revision: 1,
    updated_at: now(),
    state: "IDLE",
    owner_epoch: 1,
    active_loop_id: null,
    claimed_input_ids: [],
    last_context_id: null,
    consciousness_id: id(),
    last_journal_seq: 0,
    recovery_error: null,
  };
  store.commit([session]);
}
function seedInput(store: Store, sessionID: string, text: string): Input {
  const input: Input = {
    schema_version: 1,
    record_type: "Input",
    ...base(),
    session_id: sessionID,
    dedupe_key: id(),
    producer: "MASTER",
    state: "ACCEPTED",
    payload: store.put(text, "text/plain"),
    loop_id: null,
    received_at: now(),
    feedback_id: null,
  };
  store.commit([input]);
  return input;
}
/** The exact user message the host builds for a claimed Input. */
function inputMessage(store: Store, record: Input): AgentMessage {
  return userMessage(
    store.bytes(record.payload).toString(),
    Date.parse(record.received_at),
  );
}
/**
 * Persist a host snapshot that attests the given header message (byte-exact),
 * matching what saveContext stores when a checkpoint contains that message.
 */
function seedHeaderEvidence(
  store: Store,
  sessionID: string,
  message: AgentMessage,
  revision: number,
) {
  saveContext(
    store,
    [message],
    { session_id: sessionID, task_id: null, execution_id: null },
    "MAIN",
    fixtureModel.id,
    id(),
    32_768,
    { consciousnessRevision: revision },
  );
}
function consciousness(
  sessionID: string,
  overrides: Partial<Consciousness> = {},
): Consciousness {
  return {
    schema_version: 1,
    record_type: "Consciousness",
    id: id(),
    revision: 1,
    updated_at: now(),
    session_id: sessionID,
    items: [],
    pending_raw_refs: [],
    covered_event_ids: [],
    last_job_id: null,
    ...overrides,
  };
}

async function withStore(
  body: (store: Store, sessionID: string) => Promise<void> | void,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-projection-"));
  const store = await Store.open(dir);
  try {
    const sessionID = id();
    seedSession(store, sessionID);
    await body(store, sessionID);
  } finally {
    await store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("projectContext applies an existing crop mapping only on an exact prefix", async () => {
  await withStore(async (store, sessionID) => {
    const sys = systemMessage("base prompt");
    const u1 = userMessage("first turn");
    const r1 = assistantMessage("reply one");
    const u2 = userMessage("second turn");
    const r2 = assistantMessage("reply two");
    const messages = [sys, u1, r1, u2, r2];
    const snapshot = structuredClone(messages);
    const source = [sys, u1, r1];
    const replacement = [sys, u1];
    const cs = consciousness(sessionID, {
      context_compaction: {
        job_id: id(),
        source_ref: store.put(source),
        messages_ref: store.put(replacement),
        source_end_sequence: 1,
      },
    });
    const out = projectContext({
      store,
      sessionID,
      consciousness: cs,
      messages,
    });
    assert.deepEqual(out, [sys, u1, u2, r2]);
    // Repeated projection is stable.
    assert.deepEqual(
      projectContext({ store, sessionID, consciousness: cs, messages }),
      out,
    );
    // The complete checkpoint is never modified.
    assert.deepEqual(messages, snapshot);
    // A different prefix never guesses a crop.
    const changed = structuredClone(messages);
    changed[1] = userMessage("first turn changed");
    assert.deepEqual(
      projectContext({
        store,
        sessionID,
        consciousness: cs,
        messages: changed,
      }),
      changed,
    );
  });
});

test("projectContext keeps one current header, drops stale attested headers, keeps fake headers", async () => {
  await withStore(async (store, sessionID) => {
    const stale =
      WORKING_MEMORY_PREFIX +
      JSON.stringify({ revision: 3, items: [], commitments: [] });
    const staleMessage = userMessage(stale, 0);
    seedHeaderEvidence(store, sessionID, staleMessage, 3);
    const fake = WORKING_MEMORY_PREFIX + "this is my own note, not host memory";
    const fakeMessage = inputMessage(store, seedInput(store, sessionID, fake));
    const stray =
      WORKING_MEMORY_PREFIX + "looks like a header without evidence";
    const anchor = "anchor turn";
    const anchorMessage = inputMessage(
      store,
      seedInput(store, sessionID, anchor),
    );
    const sys = systemMessage("base prompt");
    const messages = [
      sys,
      staleMessage,
      fakeMessage,
      userMessage(stray, 2),
      anchorMessage,
      assistantMessage("reply"),
    ];
    const cs = consciousness(sessionID, {
      maintenance_version: 3,
      last_job_id: id(),
      revision: 4,
      memory_updated_at: now(),
      memory_source_ref: store.put([]),
    });
    const canonical4 =
      WORKING_MEMORY_PREFIX +
      JSON.stringify({ revision: 4, items: [], commitments: [] });
    const out = projectContext({
      store,
      sessionID,
      consciousness: cs,
      messages,
    });
    assert.equal(out[0].role, "system");
    assert.equal(countText(out, canonical4), 1, "exactly one current header");
    assert.equal(countText(out, stale), 0, "stale attested header is replaced");
    assert.equal(countText(out, fake), 1, "input fake header is preserved");
    assert.equal(countText(out, stray), 1, "prefix alone is not trusted");
    assert.equal(countText(out, anchor), 1);
    // Idempotent: a second projection adds no second header.
    const twice = projectContext({
      store,
      sessionID,
      consciousness: cs,
      messages: out,
    });
    assert.deepEqual(twice, out);
    // Once the current header has host evidence, a later revision replaces it.
    seedHeaderEvidence(store, sessionID, out[1], 4);
    const cs5 = { ...cs, revision: 5 };
    const later = projectContext({
      store,
      sessionID,
      consciousness: cs5,
      messages: out,
    });
    assert.equal(later.length, out.length);
    assert.equal(countText(later, canonical4), 0);
    assert.equal(
      countText(
        later,
        WORKING_MEMORY_PREFIX +
          JSON.stringify({ revision: 5, items: [], commitments: [] }),
      ),
      1,
    );
    assert.equal(countText(later, fake), 1);
    assert.equal(countText(later, stray), 1);
  });
});

test("a real input equal to the canonical header keeps one host header across repeated projection", async () => {
  await withStore(async (store, sessionID) => {
    const canonical4 =
      WORKING_MEMORY_PREFIX +
      JSON.stringify({ revision: 4, items: [], commitments: [] });
    const record = seedInput(store, sessionID, canonical4);
    const inputMsg = inputMessage(store, record);
    const cs = consciousness(sessionID, {
      maintenance_version: 3,
      last_job_id: id(),
      revision: 4,
      // Adversarial: the header timestamp equals the input timestamp exactly.
      memory_updated_at: record.received_at,
      memory_source_ref: store.put([]),
    });
    const messages = [systemMessage("prompt"), inputMsg];
    const hostHeaders = (projected: AgentMessage[]) =>
      projected.filter(
        (message) => message !== inputMsg && flat(message) === canonical4,
      ).length;
    const p1 = projectContext({
      store,
      sessionID,
      consciousness: cs,
      messages,
    });
    assert.equal(p1.length, 3);
    assert.equal(countText(p1, canonical4), 2);
    assert.equal(p1.filter((message) => message === inputMsg).length, 1);
    assert.equal(hostHeaders(p1), 1);
    const p2 = projectContext({
      store,
      sessionID,
      consciousness: cs,
      messages: p1,
    });
    const p3 = projectContext({
      store,
      sessionID,
      consciousness: cs,
      messages: p2,
    });
    for (const projected of [p2, p3]) {
      assert.equal(projected.length, 3, "stable size across repeated projects");
      assert.equal(
        projected.filter((message) => message === inputMsg).length,
        1,
        "the real input occurrence is never removed",
      );
      assert.equal(hostHeaders(projected), 1, "exactly one host header");
    }
    assert.deepEqual(p3, p2);
    // Persisted read path: fresh objects must classify the same way.
    const saved = saveContext(
      store,
      p2,
      { session_id: sessionID, task_id: null, execution_id: null },
      "MAIN",
      fixtureModel.id,
      id(),
      32_768,
      { consciousnessRevision: 4 },
    );
    const readback = store.read<AgentMessage[]>(saved.raw_context);
    assert.equal(readback.length, 3);
    const inputBack = readback[2];
    const p4 = projectContext({
      store,
      sessionID,
      consciousness: cs,
      messages: readback,
    });
    assert.equal(p4.length, 3);
    assert.equal(p4.filter((message) => message === inputBack).length, 1);
    assert.equal(
      p4.filter(
        (message) => message !== inputBack && flat(message) === canonical4,
      ).length,
      1,
    );
    // Evidence on independently parsed objects after a revision advance.
    const headerBack = readback[1];
    seedHeaderEvidence(store, sessionID, headerBack, 4);
    const readback2 = store.read<AgentMessage[]>(saved.raw_context);
    const cs5 = { ...cs, revision: 5 };
    const p5 = projectContext({
      store,
      sessionID,
      consciousness: cs5,
      messages: readback2,
    });
    assert.equal(p5.length, 3);
    assert.equal(
      p5.filter((message) => message === readback2[2]).length,
      1,
      "input preserved after revision advance",
    );
    assert.equal(
      countText(p5, canonical4),
      1,
      "only the real input keeps the old text",
    );
    assert.equal(
      p5.filter(
        (message) => message !== readback2[2] && flat(message) === canonical4,
      ).length,
      0,
      "the stale host header is replaced via persisted evidence",
    );
    assert.equal(
      countText(
        p5,
        WORKING_MEMORY_PREFIX +
          JSON.stringify({ revision: 5, items: [], commitments: [] }),
      ),
      1,
    );
  });
});

test("projectContext reads no Context bodies when there are no stale-header candidates", async () => {
  await withStore(async (store, sessionID) => {
    // (a) disabled: legacy consciousness never normalizes.
    const disabledCS = consciousness(sessionID, {});
    const legacy = userMessage(WORKING_MEMORY_PREFIX + "legacy header", 0);
    const m1 = [systemMessage("p"), legacy];
    // (b) enabled, no prefix-shaped candidates at all.
    const plainMessage = inputMessage(
      store,
      seedInput(store, sessionID, "plain turn"),
    );
    const m2 = [systemMessage("p"), plainMessage, assistantMessage("r")];
    const enabledCS = consciousness(sessionID, {
      maintenance_version: 3,
      last_job_id: id(),
      revision: 2,
      memory_updated_at: now(),
      memory_source_ref: store.put([]),
    });
    // (c) canonical-only: the only header-shaped message is the current one.
    const canonical2 =
      WORKING_MEMORY_PREFIX +
      JSON.stringify({ revision: 2, items: [], commitments: [] });
    const m3 = [systemMessage("p"), userMessage(canonical2, 123)];
    // (d) a stale header with honest host evidence resolves without body reads.
    const staleText =
      WORKING_MEMORY_PREFIX +
      JSON.stringify({ revision: 1, items: [], commitments: [] });
    const staleHeader = userMessage(staleText, 7);
    seedHeaderEvidence(store, sessionID, staleHeader, 1);
    const m4 = [systemMessage("p"), staleHeader];
    const reads = patchReads(store);
    const out1 = projectContext({
      store,
      sessionID,
      consciousness: disabledCS,
      messages: m1,
    });
    const out2 = projectContext({
      store,
      sessionID,
      consciousness: enabledCS,
      messages: m2,
    });
    const out3 = projectContext({
      store,
      sessionID,
      consciousness: enabledCS,
      messages: m3,
    });
    const out4 = projectContext({
      store,
      sessionID,
      consciousness: enabledCS,
      messages: m4,
    });
    assert.equal(reads.length, 0, "no Context user-body reads in any scenario");
    // Scenario sanity: behavior is unchanged without body reads.
    assert.deepEqual(
      out1,
      m1,
      "disabled normalization leaves messages untouched",
    );
    assert.equal(countText(out2, canonical2), 1, "header still injected");
    assert.equal(
      countText(out3, canonical2),
      1,
      "canonical header replaced only",
    );
    assert.equal(
      countText(out4, staleText),
      0,
      "attested stale header still removed",
    );
  });
});

test("buildCompaction keeps the least aggressive cut within target and preserves anchors", async () => {
  await withStore(async (store, sessionID) => {
    const sys = systemMessage("base " + "s".repeat(600));
    const u1 = userMessage("turn one");
    seedInput(store, sessionID, "turn one");
    const r1 = assistantMessage("ASSISTANT_R1 " + "a".repeat(12000));
    const u2 = userMessage("turn two");
    seedInput(store, sessionID, "turn two");
    const r2 = assistantMessage("ASSISTANT_R2 " + "b".repeat(12000));
    const u3 = userMessage("turn three");
    seedInput(store, sessionID, "turn three");
    const r3 = assistantMessage("ASSISTANT_R3 " + "c".repeat(3000));
    const u4 = userMessage("queued tail");
    seedInput(store, sessionID, "queued tail");
    const r4 = assistantMessage("ASSISTANT_R4 " + "d".repeat(500));
    const messages = [sys, u1, r1, u2, r2, u3, r3, u4, r4];
    const snapshot = structuredClone(messages);
    const cs = consciousness(sessionID, {
      memory_source_ref: store.put([]),
      covered_event_sequence: 0,
    });
    assert.ok(
      requestBudget(model, messages).occupancy >= budgetConfig().normal,
      "fixture must exceed the normal threshold",
    );
    const result = buildCompaction({
      store,
      sessionID,
      consciousness: cs,
      messages,
      protectedFromIndex: 7,
      model,
    });
    assert.ok(result, "a crop candidate exists");
    assert.deepEqual(result.source, messages.slice(0, 7));
    assert.equal(result.targetReached, true);
    // Recent complete round kept; older removable rounds dropped.
    assert.ok(hasMarker(result.replacement, "ASSISTANT_R3"));
    assert.ok(!hasMarker(result.replacement, "ASSISTANT_R1"));
    assert.ok(!hasMarker(result.replacement, "ASSISTANT_R2"));
    // Every real input anchor survives.
    for (const text of ["turn one", "turn two", "turn three"])
      assert.equal(countText(result.replacement, text), 1);
    // Protected tail stays verbatim, with no index skew after replacement.
    assert.deepEqual(
      result.projected.slice(result.replacement.length),
      messages.slice(result.source.length),
    );
    assert.ok(hasMarker(result.projected, "ASSISTANT_R3"));
    assert.ok(!hasMarker(result.projected, "ASSISTANT_R1"));
    assert.ok(hasMarker(result.projected, "ASSISTANT_R4"));
    assert.deepEqual(messages, snapshot, "complete checkpoint unchanged");
    // Persisting the mapping reproduces exactly the projected view.
    const cs2 = {
      ...cs,
      context_compaction: {
        job_id: id(),
        source_ref: store.put(result.source),
        messages_ref: store.put(result.replacement),
        source_end_sequence: 0,
      },
    };
    assert.deepEqual(
      projectContext({ store, sessionID, consciousness: cs2, messages }),
      result.projected,
    );
  });
});

test("buildCompaction never splits a tool pair at the protected boundary", async () => {
  await withStore(async (store, sessionID) => {
    const sys = systemMessage("base " + "s".repeat(600));
    const u1 = userMessage("turn one");
    seedInput(store, sessionID, "turn one");
    const r1 = assistantMessage("ASSISTANT_R1 " + "a".repeat(22000));
    const u2 = userMessage("turn two");
    seedInput(store, sessionID, "turn two");
    const call = toolCallMessage("call-1", "task_query");
    const toolResult = toolResultMessage("call-1", "task_query", "result body");
    const u3 = userMessage("turn three");
    seedInput(store, sessionID, "turn three");
    const r3 = assistantMessage("ASSISTANT_R3 " + "d".repeat(400));
    const messages = [sys, u1, r1, u2, call, toolResult, u3, r3];
    const cs = consciousness(sessionID, {
      memory_source_ref: store.put([]),
      covered_event_sequence: 0,
    });
    const result = buildCompaction({
      store,
      sessionID,
      consciousness: cs,
      messages,
      protectedFromIndex: 5,
      model,
    });
    assert.ok(result, "a crop candidate exists");
    // The straddling call and result stay together in the protected region.
    assert.ok(!result.source.includes(call));
    assert.ok(result.source.length <= 4);
    assert.deepEqual(
      result.projected.slice(result.replacement.length),
      messages.slice(result.source.length),
    );
    const callIndex = result.projected.indexOf(call);
    const resultIndex = result.projected.indexOf(toolResult);
    assert.ok(callIndex >= 0 && resultIndex === callIndex + 1);
    assert.equal(orphanedResults(result.projected), false);
  });
});

test("buildCompaction returns null below the threshold, without memory coverage, or with nothing to cut", async () => {
  await withStore(async (store, sessionID) => {
    // Below the normal threshold: no pointless compaction.
    const small = [
      systemMessage("small prompt"),
      userMessage("tiny turn"),
      assistantMessage("short reply"),
    ];
    const smallCS = consciousness(sessionID, {
      memory_source_ref: store.put([]),
      covered_event_sequence: 0,
    });
    assert.ok(requestBudget(model, small).occupancy < budgetConfig().normal);
    assert.equal(
      buildCompaction({
        store,
        sessionID,
        consciousness: smallCS,
        messages: small,
        protectedFromIndex: 2,
        model,
      }),
      null,
    );
    // Safety boundary: committed memory does not cover completed turns yet.
    const big = [
      systemMessage("base " + "s".repeat(600)),
      userMessage("turn one"),
      assistantMessage("ASSISTANT_R1 " + "a".repeat(22000)),
      userMessage("turn two"),
      assistantMessage("ASSISTANT_R2 " + "b".repeat(500)),
    ];
    seedInput(store, sessionID, "turn one");
    seedInput(store, sessionID, "turn two");
    assert.ok(requestBudget(model, big).occupancy >= budgetConfig().normal);
    store.commit(
      [],
      [
        store.event(
          "input.handled",
          { inputs: [] },
          { session_id: sessionID, task_id: null, execution_id: null },
          "MAIN",
        ),
      ],
    );
    const behind = consciousness(sessionID, {
      memory_source_ref: store.put([]),
      covered_event_sequence: 0,
    });
    assert.equal(
      buildCompaction({
        store,
        sessionID,
        consciousness: behind,
        messages: big,
        protectedFromIndex: 4,
        model,
      }),
      null,
      "coverage behind completed turns must not crop",
    );
    const noSource = consciousness(sessionID, { covered_event_sequence: 1 });
    assert.equal(
      buildCompaction({
        store,
        sessionID,
        consciousness: noSource,
        messages: big,
        protectedFromIndex: 4,
        model,
      }),
      null,
      "missing memory source ref must not crop",
    );
    // Nothing croppable: the protected tail starts at the first message.
    const covered = consciousness(sessionID, {
      memory_source_ref: store.put([]),
      covered_event_sequence: 1,
    });
    assert.equal(
      buildCompaction({
        store,
        sessionID,
        consciousness: covered,
        messages: big,
        protectedFromIndex: 0,
        model,
      }),
      null,
    );
    // Nothing croppable: the croppable region is already only anchors.
    const anchorsOnly = [
      systemMessage("base " + "s".repeat(600)),
      userMessage("A".repeat(22000)),
      userMessage("second anchor"),
      userMessage("protected tail anchor"),
    ];
    seedInput(store, sessionID, "A".repeat(22000));
    seedInput(store, sessionID, "second anchor");
    seedInput(store, sessionID, "protected tail anchor");
    assert.ok(
      requestBudget(model, anchorsOnly).occupancy >= budgetConfig().normal,
    );
    assert.equal(
      buildCompaction({
        store,
        sessionID,
        consciousness: covered,
        messages: anchorsOnly,
        protectedFromIndex: 3,
        model,
      }),
      null,
    );
  });
});

test("buildCompaction keeps every anchor even when anchors alone exceed the target", async () => {
  await withStore(async (store, sessionID) => {
    const bigAnchor = "U1 " + "u".repeat(22000);
    const messages = [
      systemMessage("base " + "s".repeat(600)),
      userMessage(bigAnchor),
      userMessage("second anchor"),
      assistantMessage("ASSISTANT_R2 " + "b".repeat(22000)),
    ];
    seedInput(store, sessionID, bigAnchor);
    seedInput(store, sessionID, "second anchor");
    const cs = consciousness(sessionID, {
      memory_source_ref: store.put([]),
      covered_event_sequence: 0,
    });
    assert.ok(
      requestBudget(model, messages).occupancy >= budgetConfig().normal,
    );
    const result = buildCompaction({
      store,
      sessionID,
      consciousness: cs,
      messages,
      protectedFromIndex: 4,
      model,
    });
    assert.ok(result, "candidate exists even when the target is unreachable");
    assert.equal(result.targetReached, false);
    assert.ok(countText(result.replacement, bigAnchor) === 1);
    assert.ok(countText(result.replacement, "second anchor") === 1);
    assert.ok(!hasMarker(result.replacement, "ASSISTANT_R2"));
  });
});

test("buildCompaction re-compacts an evolved checkpoint while keeping the newest suffix", async () => {
  await withStore(async (store, sessionID) => {
    const sys = systemMessage("base " + "s".repeat(600));
    const u1 = userMessage("turn one");
    const u2 = userMessage("turn two");
    const u3 = userMessage("turn three");
    const u4 = userMessage("turn four");
    const u5 = userMessage("turn five");
    for (const text of [
      "turn one",
      "turn two",
      "turn three",
      "turn four",
      "turn five",
    ])
      seedInput(store, sessionID, text);
    const r3 = assistantMessage("ASSISTANT_R3 " + "c".repeat(20000));
    const r4 = assistantMessage("ASSISTANT_R4 " + "d".repeat(600));
    const r5 = assistantMessage("ASSISTANT_R5 " + "e".repeat(400));
    const messages = [sys, u1, u2, u3, r3, u4, r4, u5, r5];
    // A stale mapping from an earlier checkpoint whose prefix no longer matches.
    const oldMapping = {
      job_id: id(),
      source_ref: store.put([
        systemMessage("old base"),
        userMessage("old turn"),
        assistantMessage("old reply"),
      ]),
      messages_ref: store.put([systemMessage("old base")]),
      source_end_sequence: 0,
    };
    const cs = consciousness(sessionID, {
      memory_source_ref: store.put([]),
      covered_event_sequence: 0,
      context_compaction: oldMapping,
    });
    // The stale mapping must not apply; the raw view still contains R3.
    const before = projectContext({
      store,
      sessionID,
      consciousness: cs,
      messages,
    });
    assert.ok(hasMarker(before, "ASSISTANT_R3"));
    assert.ok(requestBudget(model, before).occupancy >= budgetConfig().normal);
    const result = buildCompaction({
      store,
      sessionID,
      consciousness: cs,
      messages,
      protectedFromIndex: 7,
      model,
    });
    assert.ok(result, "a fresh candidate exists");
    assert.equal(result.targetReached, true);
    assert.ok(!hasMarker(result.projected, "ASSISTANT_R3"), "old bulk dropped");
    assert.ok(hasMarker(result.projected, "ASSISTANT_R4"));
    assert.ok(hasMarker(result.projected, "ASSISTANT_R5"));
    for (const text of [
      "turn one",
      "turn two",
      "turn three",
      "turn four",
      "turn five",
    ])
      assert.equal(countText(result.projected, text), 1);
    // The superseding mapping reproduces the projected view exactly.
    const cs2 = {
      ...cs,
      context_compaction: {
        job_id: id(),
        source_ref: store.put(result.source),
        messages_ref: store.put(result.replacement),
        source_end_sequence: 0,
      },
    };
    assert.deepEqual(
      projectContext({ store, sessionID, consciousness: cs2, messages }),
      result.projected,
    );
  });
});

test("identical text from different events is never collapsed or dropped", async () => {
  await withStore(async (store, sessionID) => {
    const repeated = "repeat the amber condition";
    const first = seedInput(store, sessionID, repeated);
    const second = seedInput(store, sessionID, repeated);
    assert.notEqual(first.id, second.id);
    assert.equal(first.payload.sha256, second.payload.sha256);
    const messages = [
      systemMessage("base " + "s".repeat(600)),
      userMessage(repeated),
      assistantMessage("ASSISTANT_R1 " + "a".repeat(22000)),
      userMessage(repeated),
      assistantMessage("ASSISTANT_R2 " + "b".repeat(300)),
      userMessage("turn three"),
    ];
    seedInput(store, sessionID, "turn three");
    const cs = consciousness(sessionID, {
      memory_source_ref: store.put([]),
      covered_event_sequence: 0,
    });
    const result = buildCompaction({
      store,
      sessionID,
      consciousness: cs,
      messages,
      protectedFromIndex: 5,
      model,
    });
    assert.ok(result, "a crop candidate exists");
    assert.equal(countText(result.projected, repeated), 2);
    assert.equal(countText(result.replacement, repeated), 2);
    assert.ok(!hasMarker(result.projected, "ASSISTANT_R1"));
    assert.ok(hasMarker(result.projected, "ASSISTANT_R2"));
  });
});

test("legacy header-shaped real Input occurrences survive mismatched timestamps and repeated projection", async () => {
  await withStore(async (store, sessionID) => {
    const text =
      WORKING_MEMORY_PREFIX +
      JSON.stringify({ revision: 1, items: [], commitments: [] });
    seedInput(store, sessionID, text);
    seedInput(store, sessionID, text);
    const message = userMessage(text, 1);
    seedHeaderEvidence(store, sessionID, message, 1);
    const cs = consciousness(sessionID, {
      revision: 4,
      maintenance_version: 3,
      last_job_id: id(),
    });
    const original = [systemMessage("base"), message, { ...message }];
    const once = projectContext({
      store,
      sessionID,
      consciousness: cs,
      messages: original,
    });
    const twice = projectContext({
      store,
      sessionID,
      consciousness: cs,
      messages: once,
    });
    assert.equal(countText(once, text), 2);
    assert.equal(countText(twice, text), 2);
    assert.equal(twice.length, once.length);
    assert.deepEqual(original, [
      systemMessage("base"),
      message,
      { ...message },
    ]);
  });
});

test("partial same-text Input history cannot adopt generated headers after JSON/CAS round trips", async () => {
  await withStore(async (store, sessionID) => {
    const canonical =
      WORKING_MEMORY_PREFIX +
      JSON.stringify({ revision: 4, items: [], commitments: [] });
    const records = Array.from({ length: 5 }, () =>
      seedInput(store, sessionID, canonical),
    );
    const cs = consciousness(sessionID, {
      revision: 4,
      maintenance_version: 3,
      last_job_id: id(),
      memory_updated_at: records[0].received_at,
    });
    for (const timestamp of [Date.parse(records[0].received_at), 1]) {
      const actual = userMessage(canonical, timestamp);
      const original = JSON.stringify(actual);
      let projected: AgentMessage[] = [actual];
      for (let pass = 0; pass < 10; pass++) {
        projected = projectContext({
          store,
          sessionID,
          consciousness: cs,
          messages: JSON.parse(JSON.stringify(projected)),
        });
        assert.equal(
          projected.length,
          2,
          "one real occurrence plus one explicitly identified host header",
        );
        assert.equal(
          projected.filter((message) => JSON.stringify(message) === original)
            .length,
          1,
          "real message survives byte-for-byte even when text/time collide with the host header",
        );
        assert.equal(
          projected.filter((message) => "secretary_memory_header" in message)
            .length,
          1,
        );
      }
      const context = saveContext(
        store,
        projected,
        { session_id: sessionID, task_id: null, execution_id: null },
        "MAIN",
        fixtureModel.id,
        id(),
        32768,
        { consciousnessRevision: 4 },
      );
      const fromCAS = store.read<AgentMessage[]>(context.raw_context);
      assert.deepEqual(
        fromCAS,
        projected,
        "Context serialization preserves local header provenance",
      );
      const advanced = { ...cs, revision: 5 };
      let next = projectContext({
        store,
        sessionID,
        consciousness: advanced,
        messages: fromCAS,
      });
      for (let pass = 0; pass < 5; pass++)
        next = projectContext({
          store,
          sessionID,
          consciousness: advanced,
          messages: store.read<AgentMessage[]>(store.put(next)),
        });
      assert.equal(next.length, 2);
      assert.equal(
        next.filter((message) => JSON.stringify(message) === original).length,
        1,
      );
      assert.equal(
        countText(next, canonical),
        1,
        "only genuine input keeps revision-4 text",
      );
    }
    const owned = projectContext({
      store,
      sessionID,
      consciousness: cs,
      messages: [],
    })[0];
    const marker = (owned as any).secretary_memory_header;
    for (const patch of [
      { version: 2 },
      { session_id: id() },
      { consciousness_id: id() },
      { revision: 5 },
      { content_sha256: "wrong" },
    ]) {
      const unknown = {
        ...owned,
        secretary_memory_header: { ...marker, ...patch },
      };
      let projected: AgentMessage[] = [unknown];
      for (let pass = 0; pass < 3; pass++) {
        projected = projectContext({
          store,
          sessionID,
          consciousness: cs,
          messages: JSON.parse(JSON.stringify(projected)),
        });
        assert.equal(projected.length, 2);
        assert.equal(
          projected.filter(
            (message) => JSON.stringify(message) === JSON.stringify(unknown),
          ).length,
          1,
          "unknown or damaged explicit provenance must survive rather than be guessed away",
        );
      }
    }
    const invalidCS = { ...cs, id: undefined } as unknown as Consciousness;
    const raw = [userMessage(canonical, 1)];
    assert.deepEqual(
      projectContext({
        store,
        sessionID,
        consciousness: invalidCS,
        messages: raw,
      }),
      raw,
      "missing ownership identity must fail conservatively without inserting/removing messages",
    );
  });
});

test("persisted host header identity survives Pi conversion but is omitted from both provider payloads", async () => {
  await withStore(async (store, sessionID) => {
    const cs = consciousness(sessionID, {
      revision: 2,
      maintenance_version: 3,
      last_job_id: id(),
    });
    const projected = projectContext({
      store,
      sessionID,
      consciousness: cs,
      messages: [userMessage("Synthetic actual input")],
    });
    const serialized = store.read<AgentMessage[]>(store.put(projected));
    const agent = new Agent({
      initialState: { model: fixtureModel, messages: serialized, tools: [] },
      streamFn: () => {
        throw Error("unused");
      },
    });
    const converted = await agent.convertToLlm(agent.state.messages);
    assert(
      converted.some((message) => "secretary_memory_header" in message),
      "Pi public default converter retains local identity through normalized request capture",
    );
    for (const modelID of ["deepseek-v4.1-flash", "gpt-5.6-luna"]) {
      const registered = getModel("opencode-go", modelID as never)!;
      const model = { ...registered, baseUrl: "http://127.0.0.1:1/never-send" };
      const config = roleModel(model, "synthetic-not-a-real-key");
      let captured = false;
      const response = await config.stream(
        model,
        normalizeContext({ messages: converted }),
        {
          onPayload: (payload) => {
            captured = true;
            assert(
              !JSON.stringify(payload).includes("secretary_memory_header"),
              "local provenance must not become an unsupported provider field",
            );
            throw Error("SYNTHETIC_PAYLOAD_CAPTURE_COMPLETE");
          },
        },
      );
      const result = await response.result();
      assert(captured);
      assert.match(
        result.errorMessage ?? "",
        /SYNTHETIC_PAYLOAD_CAPTURE_COMPLETE/,
      );
    }
  });
});
