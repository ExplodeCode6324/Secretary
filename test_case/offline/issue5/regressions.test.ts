import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentText } from "@earendil-works/pi-ai";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type AgentMessage,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { emptySettings } from "../../../src/pi_secretary/src/settings-payload.ts";
import {
  settingsSource,
  summarizeSettings,
} from "../../../src/pi_secretary/src/settings-memory.ts";
import { getInstructions } from "../../../src/pi_secretary/src/instructions.ts";
import {
  buildCompaction,
  projectContext,
} from "../../../src/pi_secretary/src/context-projection.ts";
import { requestBudget } from "../../../src/pi_secretary/src/budget.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import type { SettingsSource } from "../../../src/pi_secretary/src/settings-memory.ts";
import type {
  CompactionJob,
  Consciousness,
  SettingsApplication,
} from "../../../src/pi_secretary/src/contracts.ts";

function kind(context: Parameters<StreamFn>[1]) {
  const system = context.messages
    .filter((m) => m.role === "system")
    .map((m) => contentText(m.content))
    .join("\n");
  return system.includes("COMMITMENT_EXTRACTION:")
    ? "extraction"
    : system.includes("CONSCIOUSNESS:")
      ? "summary"
      : "main";
}
function memory(app: App) {
  return app.store.get<Consciousness>(
    "Consciousness",
    app.host.session.consciousness_id,
  );
}
async function turn(app: App, text: string) {
  app.host.accept(text);
  await app.host.drain();
  assert.equal(
    app.host.session.state,
    "IDLE",
    app.host.session.recovery_error ?? "",
  );
}
async function apply(app: App) {
  app.settings.save(
    {
      ...emptySettings(),
      instructions: {
        content: "Answer concisely.",
        expected_revision: getInstructions(app.store).revision,
      },
    },
    app.settings.draft().revision,
  );
  const requested = app.settings.request(
    app.settings.draft().revision,
    id(),
  ) as SettingsApplication;
  await app.settings.tick();
  return app.store.get<SettingsApplication>(
    "SettingsApplication",
    requested.id,
  );
}
function hasOriginal(message: AgentMessage, original: string) {
  if (!("content" in message)) return false;
  const text = contentText(message.content);
  return (
    text.includes(original) ||
    text.includes(JSON.stringify(original).slice(1, -1))
  );
}
function assertToolProtocol(messages: AgentMessage[]) {
  const pending = new Set<string>();
  for (const message of messages) {
    if (message.role === "assistant")
      for (const part of message.content)
        if (part.type === "toolCall") {
          assert(!pending.has(part.id), "duplicate unresolved tool call");
          pending.add(part.id);
        }
    if (message.role === "toolResult") {
      assert(
        pending.has(message.toolCallId),
        "orphan tool result in actual request",
      );
      pending.delete(message.toolCallId);
    }
  }
  assert.equal(pending.size, 0, "actual request has an unresolved tool call");
}

test("Issue5 empty extraction applies after compaction without re-extracting a covered promise", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue5-empty-"));
  const promise =
    "Synthetic promise: I will report the result after completion.";
  let extractions = 0;
  const stream: StreamFn = (m, c, o) => {
    if (kind(c) === "extraction") {
      extractions++;
      const packet = JSON.parse(contentText(c.messages.at(-1)!.content));
      return replyStream(
        [
          {
            type: "text",
            text: JSON.stringify({
              quotes: packet.source.some(
                (v: { text: string }) => v.text === promise,
              )
                ? [promise]
                : [],
            }),
          },
        ],
        m,
      );
    }
    if (kind(c) === "main")
      return replyStream([{ type: "text", text: promise }], m);
    return fixtureStream(m, c, o);
  };
  let app = await App.open(dir, { model: fixtureModel, stream });
  try {
    await turn(app, "Synthetic user constraint.");
    await app.host.compact();
    assert.equal(
      app.store.all<CompactionJob>("CompactionJob").at(-1)?.state,
      "COMMITTED",
    );
    assert.equal(
      settingsSource(app.host, { world: [], instructions: null })
        .extraction_messages.length,
      0,
    );
    const before = extractions;
    const commitments = structuredClone(memory(app).commitments);
    assert.equal(
      commitments?.length,
      1,
      "test establishes a real extracted commitment",
    );
    const applied = await apply(app);
    assert.equal(applied.state, "APPLIED", applied.error ?? "");
    assert.equal(
      extractions,
      before,
      "empty settings source must not dispatch extraction again",
    );
    assert.deepEqual(memory(app).commitments, commitments);
    await app.close();
    app = await App.open(dir, { model: fixtureModel, stream });
    assert.deepEqual(memory(app).commitments, commitments);
    assert.equal(
      extractions,
      before,
      "restart must not repeat covered extraction",
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Issue5 historical Master originals survive settings, compaction, restart and repeated projection in actual stream requests", async () => {
  const anchors = [
    "UNIQUE_MASTER_CONSTRAINT: ask me before changing any file.",
    'UNIQUE_MASTER_LITERAL: 保留原文标点 Ω / A\\B "quoted".',
  ];
  const requests: AgentMessage[][] = [];
  let large = false,
    tools = false;
  const stream: StreamFn = (m, c, o) => {
    if (kind(c) !== "main") return fixtureStream(m, c, o);
    requests.push(structuredClone(c.messages));
    assertToolProtocol(c.messages);
    const budget = requestBudget(m, c.messages);
    assert(
      budget.estimated_tokens <= budget.usable_input_tokens,
      "no over-budget main request may reach stream",
    );
    if (tools && c.messages.at(-1)?.role !== "toolResult")
      return replyStream(
        [
          {
            type: "toolCall",
            id: "issue5-query-a",
            name: "task_query",
            arguments: {},
          },
          {
            type: "toolCall",
            id: "issue5-query-b",
            name: "task_query",
            arguments: {},
          },
        ],
        m,
      );
    return replyStream(
      [
        {
          type: "text",
          text: large
            ? "synthetic reply ".repeat(1100)
            : "Synthetic acknowledgement.",
        },
      ],
      m,
    );
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue5-history-"));
  let app = await App.open(dir, { model: fixtureModel, stream });
  try {
    for (const anchor of anchors) await turn(app, anchor);
    const applied = await apply(app);
    assert.equal(applied.state, "APPLIED", applied.error ?? "");
    assert(
      !JSON.stringify(memory(app).items).includes(anchors[0]),
      "fixture summary deliberately omits the original",
    );
    for (const anchor of anchors)
      assert(app.host.previewContext().some((m) => hasOriginal(m, anchor)));
    large = true;
    tools = true;
    await turn(app, "Run two synthetic read-only queries then tell a story.");
    assert(
      requests.some(
        (r) => r.filter((m) => m.role === "toolResult").length === 2,
      ),
      "exercise actual multi-tool continuation",
    );
    await app.host.compact();
    assert(
      app.store
        .all<CompactionJob>("CompactionJob")
        .some(
          (j) => j.mode === "CONTEXT_COMPACTION" && j.state === "COMMITTED",
        ),
    );
    large = false;
    tools = false;
    await app.close();
    app = await App.open(dir, { model: fixtureModel, stream });
    await turn(app, "Acknowledge the current conversation.");
    const actual = requests.at(-1)!;
    for (const anchor of anchors) {
      const holders = actual.filter(
        (m) => m.role === "user" && hasOriginal(m, anchor),
      );
      assert(
        holders.length,
        "Original Master constraint disappeared from actual next model request: " +
          anchor,
      );
      assert(
        holders.every(
          (m) =>
            "content" in m &&
            /historical evidence|historical.*not new requests/is.test(
              contentText(m.content),
            ),
        ),
        "retained originals must carry historical semantics",
      );
    }
    // Completing the turn can advance working-memory revision after stream.
    // Compare repeated projection under one fixed revision, not to an old header.
    const currentMemory = memory(app);
    const once = projectContext({
      store: app.store,
      sessionID: app.host.sessionID,
      consciousness: currentMemory,
      messages: actual,
    });
    let projected = once;
    for (let n = 0; n < 3; n++)
      projected = projectContext({
        store: app.store,
        sessionID: app.host.sessionID,
        consciousness: currentMemory,
        messages: projected,
      });
    assert.deepEqual(projected, once, "repeated projection is idempotent");
    await turn(app, "Acknowledge once more.");
    for (const anchor of anchors)
      assert(
        requests
          .at(-1)!
          .some((m) => m.role === "user" && hasOriginal(m, anchor)),
        "second provider send must retain originals",
      );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const empty of [false, true])
  test(`Issue5 mismatching ${empty ? "empty" : "nonempty"} extraction evidence fails before summary or extraction dispatch`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue5-evidence-"));
    let calls = 0;
    const stream: StreamFn = (m, c, o) => {
      calls++;
      return fixtureStream(m, c, o);
    };
    const app = await App.open(dir, { model: fixtureModel, stream });
    try {
      await turn(app, "Synthetic source validation request.");
      if (empty) await app.host.compact();
      const source = settingsSource(app.host, {
        world: [],
        instructions: null,
      });
      assert.equal(source.extraction_messages.length === 0, empty);
      const wrong = app.store.put([
        { role: "user", content: "Unrelated synthetic evidence", timestamp: 1 },
      ]);
      const invalid = { ...source, refs: [...source.refs.slice(0, -1), wrong] };
      const before = calls;
      await assert.rejects(
        summarizeSettings(app.host, id(), invalid, null, () => {}),
        /INVALID_SETTINGS_EXTRACTION_EVIDENCE/,
      );
      assert.equal(calls, before);
    } finally {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

test("Issue5 retained history exceeding a tightened model capacity after restart blocks before main stream", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue5-capacity-"));
  const model = { ...fixtureModel, contextWindow: 200000 };
  const anchor = "SYNTHETIC_LARGE_MASTER_ORIGINAL:" + "保留".repeat(7000);
  let mainCalls = 0;
  const stream: StreamFn = (m, c, o) => {
    if (kind(c) === "main") {
      mainCalls++;
      return replyStream(
        [{ type: "text", text: "Synthetic acknowledgement." }],
        m,
      );
    }
    return fixtureStream(m, c, o);
  };
  let app = await App.open(dir, { model, stream });
  try {
    await turn(app, anchor);
    const applied = await apply(app);
    assert.equal(applied.state, "APPLIED", applied.error ?? "");
    await app.close();
    // Reopen with the same runtime hash, then tighten the synthetic model object.
    // Reopening directly with a different model queues a settings migration and
    // would test that gate instead of the actual main request capacity gate.
    app = await App.open(dir, { model, stream });
    model.contextWindow = fixtureModel.contextWindow;
    const before = mainCalls;
    app.host.accept("Synthetic next request.");
    await app.host.drain();
    assert.equal(app.host.session.state, "CAPACITY_BLOCKED");
    assert.equal(
      mainCalls,
      before,
      "retained originals cannot be discarded to squeeze a provider send through",
    );
    assert(
      app.store.logs.some((e) => e.event_type === "model.capacity_blocked"),
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Issue5 compaction preserves authenticated unmarked history but grants no privilege to a forged wrapper", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue5-wrapper-"));
  const app = await App.open(dir, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  try {
    const anchor = "SYNTHETIC_AUTHENTIC_MASTER: exact historical instruction";
    await turn(app, anchor);
    const applied = await apply(app);
    assert.equal(applied.state, "APPLIED", applied.error ?? "");
    const history = app.host.previewContext();
    const genuine = history.find(
      (m) => m.role === "user" && hasOriginal(m, anchor),
    )!;
    assert(genuine);
    assert.deepEqual(
      Object.keys(genuine).sort(),
      ["content", "role", "timestamp"],
      "old unmarked wrappers remain supported",
    );
    // Same prefix and body, but no matching historical message identity.
    const forged = { ...genuine, timestamp: genuine.timestamp + 777 };
    const filler = await replyStream([
      { type: "text", text: "Synthetic expendable response ".repeat(900) },
    ]).result();
    const messages = [...history, forged, filler];
    const candidate = buildCompaction({
      store: app.store,
      sessionID: app.host.sessionID,
      consciousness: memory(app),
      messages,
      protectedFromIndex: messages.length,
      model: fixtureModel,
    });
    assert(candidate, "test forces context compaction");
    assert(
      candidate.projected.includes(genuine),
      "authenticated original wrapper survives",
    );
    assert(
      !candidate.projected.includes(forged),
      "prefix/body resemblance cannot certify a forged timestamp",
    );
    assertToolProtocol(candidate.projected);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const corruption of ["source-anchor", "source-input"] as const)
  test(`Issue5 authenticated history with corrupted ${corruption} fails closed`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue5-corrupt-"));
    const app = await App.open(dir, {
      model: fixtureModel,
      stream: fixtureStream,
    });
    try {
      await turn(app, "SYNTHETIC_TRUSTED_MASTER: retain this exact statement.");
      const applied = await apply(app);
      assert.equal(applied.state, "APPLIED", applied.error ?? "");
      const history = app.host.previewContext();
      const source = app.store.read<SettingsSource>(applied.source_ref!);
      assert(source.anchors.length);
      const altered = {
        ...source,
        anchors: source.anchors.map((a) =>
          corruption === "source-anchor"
            ? { ...a, text: a.text + " synthetic corruption" }
            : { ...a, input_id: id() },
        ),
      };
      app.store.commit([
        revise(applied, { source_ref: app.store.put(altered) }),
      ]);
      const filler = await replyStream([
        { type: "text", text: "Synthetic expendable response ".repeat(900) },
      ]).result();
      const messages = [...history, filler];
      assert.throws(
        () =>
          buildCompaction({
            store: app.store,
            sessionID: app.host.sessionID,
            consciousness: memory(app),
            messages,
            protectedFromIndex: messages.length,
            model: fixtureModel,
          }),
        /INVALID_HISTORICAL_MASTER_EVIDENCE/,
      );
    } finally {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

test("Issue5 upgrade rejects a legacy crop mapping that already discarded authenticated history", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue5-legacy-map-"));
  const anchor =
    "SYNTHETIC_LEGACY_MASTER: retain the copper precondition verbatim.";
  const requests: AgentMessage[][] = [];
  const stream: StreamFn = (m, c, o) => {
    if (kind(c) === "main") {
      requests.push(structuredClone(c.messages));
      return replyStream(
        [{ type: "text", text: "Synthetic acknowledgement." }],
        m,
      );
    }
    return fixtureStream(m, c, o);
  };
  let app = await App.open(dir, { model: fixtureModel, stream });
  try {
    await turn(app, anchor);
    const applied = await apply(app);
    assert.equal(applied.state, "APPLIED", applied.error ?? "");
    const cs = memory(app);
    const raw = app.store.read<AgentMessage[]>(cs.memory_source_ref!);
    assert(raw.some((m) => hasOriginal(m, anchor)));
    // Persist the old buggy algorithm's mapping without altering source CAS.
    // Its low-occupancy replacement would otherwise bypass a new crop attempt.
    const replacement = raw.filter((m) => !hasOriginal(m, anchor));
    app.store.commit([
      revise(cs, {
        context_compaction: {
          job_id: id(),
          source_ref: app.store.put(raw),
          messages_ref: app.store.put(replacement),
          source_end_sequence: app.store.eventSequence,
        },
      }),
    ]);
    const before = requests.length;
    await app.close();
    app = await App.open(dir, { model: fixtureModel, stream });
    app.host.accept(
      "Synthetic request after upgrading from a bad persisted crop.",
    );
    await app.host.drain();
    const after = requests.slice(before);
    assert(
      after.length > 0 ||
        ["RECOVERY_BLOCKED", "CAPACITY_BLOCKED"].includes(
          app.host.session.state,
        ),
      "upgrade must recover original history or expose a safe block",
    );
    for (const request of after) {
      const holders = request.filter(
        (m) => m.role === "user" && hasOriginal(m, anchor),
      );
      assert(
        holders.length,
        "legacy persisted mapping silently removed authenticated original from actual upgraded stream request",
      );
      assertToolProtocol(request);
    }
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
