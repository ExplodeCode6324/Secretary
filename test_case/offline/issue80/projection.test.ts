import test from "node:test";
import assert from "node:assert/strict";
import { fixture, until } from "../issue9/helpers.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import { replyStream } from "../../../src/pi_secretary/src/model.ts";
import { validate } from "../../../src/pi_secretary/src/api/protocol.ts";
import { Previews } from "../../../src/pi_secretary/src/preview.ts";
import {
  timelineFor,
  FRAGMENT_BYTES,
  PAGE_BYTES,
} from "../../../src/pi_secretary/src/timeline.ts";
import type {
  AssistantMessage,
  AssistantMessageEvent,
} from "@earendil-works/pi-ai";

type Fixture = Parameters<Parameters<typeof fixture>[0]>[0];
const scope = (f: Fixture) => ({
  session_id: f.app.host.sessionID,
  task_id: null,
  execution_id: null,
});
function record(
  f: Fixture,
  content: unknown[],
  stopReason = "stop",
  call = id(),
) {
  const event = f.app.store.event(
    "main.message",
    { role: "assistant", content, stopReason, display_call_id: call },
    scope(f),
  );
  f.app.store.commit([], [event]);
  return { event, message: "message:" + call, call };
}
async function partial(
  thinking: string,
  redacted = false,
): Promise<AssistantMessage> {
  return replyStream([
    {
      type: "thinking",
      thinking,
      redacted,
      thinkingSignature: "PRIVATE_SIGNATURE",
    },
  ]).result();
}
function update(previews: Previews, call: string, message: AssistantMessage) {
  previews.update({
    type: "event",
    id: call,
    event: {
      type: "thinking_end",
      contentIndex: 0,
      content:
        message.content[0].type === "thinking"
          ? message.content[0].thinking
          : "",
      partial: message,
    } as AssistantMessageEvent,
  });
}
async function transient(f: Fixture) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(
      f.server.endpoint.url +
        "/api/v1/sync/stream?after=" +
        encodeURIComponent(f.cursor()),
      {
        headers: { Authorization: "Bearer " + f.server.endpoint.token },
        signal: controller.signal,
      },
    );
    assert.equal(response.status, 200);
    const reader = response.body!.getReader(),
      decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const chunk = await reader.read();
      assert(!chunk.done);
      buffer += decoder.decode(chunk.value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (frame.startsWith("event: transient")) {
          assert(!frame.includes("\nid:"));
          return JSON.parse(frame.split("data: ")[1]);
        }
      }
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
    await until(() => f.server.streams.active === 0);
  }
}

// Issue #80: empty exceptional outputs must remain status-bearing without inventing a body.
test("empty abnormal outcomes survive projection and reopen; normal empty/tool-only stays omitted", () =>
  fixture(async (f) => {
    const saved: { id: string; outcome: string }[] = [];
    for (const [reason, outcome] of [
      ["length", "truncated"],
      ["error", "failed"],
      ["aborted", "interrupted"],
    ]) {
      for (const content of [
        [],
        [{ type: "text", text: "" }],
        [{ type: "thinking", thinking: "REDACTED_SECRET", redacted: true }],
      ]) {
        const item = record(f, content, reason);
        saved.push({ id: item.message, outcome });
      }
    }
    const omitted = [
      record(f, [], "stop"),
      record(
        f,
        [{ type: "toolCall", id: id(), name: "memory_read", arguments: {} }],
        "toolUse",
      ),
    ];
    for (let reopen = 0; reopen < 2; reopen++) {
      const page: any = await f.client.query("timeline?limit=200");
      for (const expected of saved) {
        const row = page.items.find((r: any) => r.id === expected.id);
        assert(row, expected.outcome + " needs an empty status row");
        assert.equal(row.text, "");
        assert.equal(row.outcome, expected.outcome);
        assert.equal(row.incomplete, true);
        assert.equal(row.next_cursor, null);
        assert.equal(row.thinking_preview, undefined);
      }
      assert(
        !page.items.some((r: any) => omitted.some((x) => x.message === r.id)),
      );
      assert(!JSON.stringify(page).includes("REDACTED_SECRET"));
      if (!reopen) await f.restart();
    }
  }));

// Issue #80 B1: historical reused display IDs must not overwrite their earlier reply or event locator.
test("status-only collisions preserve earlier body and around-by-event identities, including tool-only reservations", () =>
  fixture(async (f) => {
    const first = record(
      f,
      [
        { type: "text", text: "preserve the first reply" },
        { type: "toolCall", id: id(), name: "probe", arguments: {} },
      ],
      "toolUse",
    );
    const failed = record(f, [], "error", first.call);
    const tool = record(
      f,
      [{ type: "toolCall", id: id(), name: "probe", arguments: {} }],
      "toolUse",
    );
    const toolFailed = record(f, [], "error", tool.call);
    for (let reopen = 0; reopen < 2; reopen++) {
      for (const [event, expected, body, outcome] of [
        [first.event, first.message, "preserve the first reply", "continued"],
        [failed.event, failed.event.event_id, "", "failed"],
        [toolFailed.event, toolFailed.event.event_id, "", "failed"],
      ] as const) {
        const page: any = await f.client.query(
          "timeline/around?event_id=" + event.event_id,
        );
        const row = page.items.find((r: any) => r.id === expected);
        assert(row, "event locator must resolve its own stable row");
        assert.equal(row.text, body);
        assert.equal(row.outcome, outcome);
        assert.equal(row.source_event_id, event.event_id);
        if (event !== first.event) assert.equal(row.call_id, null);
      }
      if (!reopen) await f.restart();
    }
  }));

// Expected strings are independent fixtures, not generated by the production segmentation helper.
test("20-grapheme preview preserves CJK, flags, ZWJ, modifiers, combining marks, and byte limits", async () => {
  const family = "👨‍👩‍👧‍👦",
    mark = "e\u0301",
    flag = "🇭🇰",
    tone = "👍🏽";
  const examples: [string, unknown][] = [
    ["", undefined],
    ["中文", { text: "中文", truncated: false }],
    ["中".repeat(20), { text: "中".repeat(20), truncated: false }],
    ["中".repeat(21), { text: "中".repeat(20) + "…", truncated: true }],
    [family.repeat(21), { text: family.repeat(20) + "…", truncated: true }],
    [mark.repeat(21), { text: mark.repeat(20) + "…", truncated: true }],
    [flag.repeat(21), { text: flag.repeat(20) + "…", truncated: true }],
    [tone.repeat(21), { text: tone.repeat(20) + "…", truncated: true }],
    ["a" + "\u0301".repeat(100000), { text: "", truncated: true }],
    ["ok\ud83d", { text: "ok…", truncated: true }],
    ["ok\ud83d" + "x".repeat(9000), { text: "ok…", truncated: true }],
    ["…".repeat(21), { text: "…".repeat(21), truncated: true }],
  ];
  for (const [input, expected] of examples) {
    const p = new Previews();
    p.update({ type: "start", id: "p", loop: "l", session: "s" });
    update(p, "p", await partial(input));
    const got: any = p.snapshot("s", false)[0];
    assert.deepEqual(got.thinking_preview, expected, input.slice(0, 40));
    assert(!got.blocks.some((b: any) => b.type === "thinking"));
    if (got.thinking_preview)
      assert(
        Buffer.byteLength(JSON.stringify(got.thinking_preview.text)) <= 4096,
      );
  }
});

test("default GET and actual SSE share a short preview; explicit expansion and body-only pagination stay bounded", () =>
  fixture(async (f) => {
    const thinking =
      "中".repeat(20) + "HIDDEN_SENTINEL" + "👩‍💻e\u0301".repeat(5000);
    const p = f.app.host.previews,
      call = id();
    p.update({
      type: "start",
      id: call,
      loop: "l",
      session: f.app.host.sessionID,
    });
    update(p, call, await partial(thinking));
    const before = f.app.store.sequence;
    const page: any = await f.client.query("timeline");
    const row = page.items.find((r: any) => r.id === "message:" + call);
    assert.deepEqual(row.thinking_preview, {
      text: "中".repeat(20) + "…",
      truncated: true,
    });
    assert.equal(row.thinking, undefined);
    assert.equal(row.text, "");
    assert.equal(row.next_cursor, null);
    const wire = await transient(f);
    validate("SSETransient", { ...wire });
    validate("Message", row);
    assert.deepEqual(
      wire.previews.find((x: any) => x.id === call).thinking_preview,
      row.thinking_preview,
    );
    assert(!JSON.stringify([page, wire]).includes("HIDDEN_SENTINEL"));
    assert(!JSON.stringify([page, wire]).includes("PRIVATE_SIGNATURE"));
    assert.equal(f.app.store.sequence, before, "display reads must not write");
    const durable = record(f, [{ type: "thinking", thinking }], "length", call);
    const get: any = await f.client.query(
      "messages/" + durable.message + "/content",
    );
    assert.deepEqual(get.thinking_preview, row.thinking_preview);
    assert.equal(get.next_cursor, null);
    let expanded: any = await f.client.query(
        "messages/" + durable.message + "/content?thinking=true",
      ),
      reconstructed = expanded.thinking,
      pages = 1;
    const firstCursor = expanded.next_cursor;
    while (expanded.next_cursor) {
      assert(pages++ < 40);
      expanded = await f.client.query(
        "messages/" +
          durable.message +
          "/content?thinking=true&cursor=" +
          encodeURIComponent(expanded.next_cursor),
      );
      assert(Buffer.byteLength(JSON.stringify(expanded)) <= FRAGMENT_BYTES);
      reconstructed += expanded.thinking;
    }
    assert.equal(reconstructed, thinking);
    await assert.rejects(
      f.client.query(
        "messages/" +
          durable.message +
          "/content?cursor=" +
          encodeURIComponent(firstCursor),
      ),
      /CURSOR_EXPIRED/,
    );
    const body = "body😀".repeat(5000),
      textRecord = record(f, [
        { type: "text", text: body },
        { type: "thinking", thinking },
      ]);
    let part: any = await f.client.query(
        "messages/" + textRecord.message + "/content",
      ),
      all = part.text,
      n = 1;
    while (part.next_cursor) {
      assert(n++ < 30);
      part = await f.client.query(
        "messages/" +
          textRecord.message +
          "/content?cursor=" +
          encodeURIComponent(part.next_cursor),
      );
      assert.equal(part.thinking, undefined);
      all += part.text;
    }
    assert.equal(all, body);
    await assert.rejects(
      f.client.query(
        "messages/" +
          textRecord.message +
          "/content?thinking=true&cursor=" +
          encodeURIComponent(firstCursor),
      ),
      /CURSOR_EXPIRED/,
    );
  }));

test("redaction revokes retained thinking, advances revision and expires cursors before checking offsets", () =>
  fixture(async (f) => {
    const p = f.app.host.previews,
      call = id();
    p.update({
      type: "start",
      id: call,
      loop: "l",
      session: f.app.host.sessionID,
    });
    update(p, call, await partial("visible".repeat(2000)));
    const first: any = await f.client.query(
      "messages/message:" + call + "/content?thinking=true&streaming=true",
    );
    assert(first.next_cursor);
    update(p, call, await partial("REDACTED_SECRET", true));
    await assert.rejects(
      f.client.query(
        "messages/message:" +
          call +
          "/content?thinking=true&streaming=true&cursor=" +
          encodeURIComponent(first.next_cursor),
      ),
      /CURSOR_EXPIRED/,
    );
    const fresh: any = await f.client.query(
      "messages/message:" + call + "/content?thinking=true&streaming=true",
    );
    assert(BigInt(fresh.revision) > BigInt(first.revision));
    assert.equal(fresh.thinking, "");
    assert.equal(fresh.thinking_preview, undefined);
    assert.equal(fresh.next_cursor, null);
    assert(
      !JSON.stringify(p.snapshot(f.app.host.sessionID, true)).includes(
        "visible",
      ),
    );
    // Known limitation: the normal redacted-only durable event remains omitted, so the empty transient later expires.
    record(
      f,
      [{ type: "thinking", thinking: "REDACTED_SECRET", redacted: true }],
      "stop",
      call,
    );
    for (let i = 0; i < 9; i++)
      p.update({
        type: "start",
        id: id(),
        loop: "l",
        session: f.app.host.sessionID,
      });
    const expired: any = await f.client.query(
      "messages/message:" + call + "/content?streaming=true",
    );
    assert.equal(expired.persistence, "transient");
    assert.equal(expired.preview_availability, "expired");
    assert.equal(expired.thinking_preview, undefined);
  }));

test("preview replacement, eviction, late durable arrival and restart retain identity without stale content", () =>
  fixture(async (f) => {
    const p = f.app.host.previews,
      call = id();
    p.update({
      type: "start",
      id: call,
      loop: "l",
      session: f.app.host.sessionID,
    });
    update(p, call, await partial("temporary"));
    const old = timelineFor(f.app)
      .query(f.app.host.sessionID)
      .items.find((r: any) => r.id === "message:" + call);
    for (let i = 0; i < 9; i++)
      p.update({
        type: "start",
        id: id(),
        loop: "l",
        session: f.app.host.sessionID,
      });
    const expired: any = await f.client.query(
      "messages/message:" + call + "/content",
    );
    assert.equal(expired.thinking_preview, undefined);
    assert.equal(expired.preview_availability, "expired");
    record(
      f,
      [
        { type: "thinking", thinking: "authoritative" },
        { type: "text", text: "body" },
      ],
      "stop",
      call,
    );
    p.update({
      type: "start",
      id: call,
      loop: "l",
      session: f.app.host.sessionID,
    });
    update(p, call, await partial("STALE_TRANSIENT"));
    const final = timelineFor(f.app)
      .query(f.app.host.sessionID)
      .items.filter((r: any) => r.id === "message:" + call);
    assert.equal(final.length, 1);
    assert.equal(final[0].order, old.order);
    for (let reopen = 0; reopen < 2; reopen++) {
      const content: any = await f.client.query(
        "messages/message:" + call + "/content",
      );
      assert.equal(content.persistence, "durable");
      assert.equal(content.text, "body");
      assert.deepEqual(content.thinking_preview, {
        text: "authoritative",
        truncated: false,
      });
      if (!reopen) await f.restart();
    }
  }));

test("200 candidate rows include bounded previews within whole fragment and timeline byte budgets", () =>
  fixture(async (f) => {
    // Large but valid clusters stress JSON escaping and preview overhead, independently of the 20-character count.
    const cluster = "a" + "\u0301".repeat(100),
      thinking = cluster.repeat(40),
      text = "\u0001".repeat(30000);
    for (let i = 0; i < 200; i++)
      record(f, [
        { type: "text", text },
        { type: "thinking", thinking },
      ]);
    const page = timelineFor(f.app).query(f.app.host.sessionID, {
      limit: 200,
      thinking: true,
    });
    assert(page.items.length > 0);
    assert(Buffer.byteLength(JSON.stringify(page)) <= PAGE_BYTES);
    for (const row of page.items) {
      assert(row.thinking_preview);
      assert(Buffer.byteLength(JSON.stringify(row)) <= FRAGMENT_BYTES);
    }
  }));

test("live preview reads ordered snapshots before body retention and revokes on terminal snapshots", async () => {
  const p = new Previews();
  p.update({ type: "start", id: "p", loop: "l", session: "s" });
  const full = await replyStream([
    { type: "text", text: "x".repeat(32768) },
    { type: "thinking", thinking: "first" },
    { type: "thinking", thinking: "", redacted: false },
    { type: "thinking", thinking: "SECRET", redacted: true },
    { type: "thinking", thinking: "second" },
  ]).result();
  p.update({
    type: "event",
    id: "p",
    event: {
      type: "text_end",
      contentIndex: 0,
      content: "x".repeat(32768),
      partial: full,
    },
  });
  p.update({
    type: "event",
    id: "p",
    event: {
      type: "thinking_end",
      contentIndex: 1,
      content: "first",
      partial: full,
    },
  });
  const snap = p.snapshot("s", true)[0];
  assert.deepEqual(snap.thinking_preview, {
    text: "first\nsecond",
    truncated: false,
  });
  assert(snap.truncated);
  assert(snap.blocks.reduce((n, b) => n + b.text.length, 0) <= 32768);
  snap.thinking_preview!.text = "MUTATED";
  assert.equal(
    p.snapshot("s", false)[0].thinking_preview?.text,
    "first\nsecond",
  );
  for (const terminal of ["done", "error"] as const) {
    const q = new Previews();
    q.update({ type: "start", id: "q", loop: "l", session: "s" });
    update(q, "q", await partial("revocable"));
    const previous = q.revision,
      redacted = await partial("SECRET", true);
    q.update({
      type: "event",
      id: "q",
      event:
        terminal === "done"
          ? { type: "done", reason: "stop", message: redacted }
          : { type: "error", reason: "error", error: redacted },
    });
    assert(q.revision > previous);
    assert.equal(q.snapshot("s", true)[0].thinking_preview, undefined);
    assert.equal(q.snapshot("s", true)[0].blocks.length, 0);
  }
  const q = new Previews();
  q.update({ type: "start", id: "q", loop: "l", session: "s" });
  for (const value of ["👩", "👩‍", "👩‍💻", "👩‍💻e", "👩‍💻e\u0301"]) {
    q.update({
      type: "event",
      id: "q",
      event: {
        type: "thinking_delta",
        contentIndex: 0,
        delta: "ignored duplicate delta",
        partial: await partial(value),
      },
    });
  }
  assert.deepEqual(q.snapshot("s", false)[0].thinking_preview, {
    text: "👩‍💻e\u0301",
    truncated: false,
  });
  assert.equal(q.snapshot("s", true)[0].blocks[0].text, "👩‍💻e\u0301");
  const many = await replyStream([
    ...Array.from({ length: 128 }, () => ({
      type: "text" as const,
      text: "x",
    })),
    { type: "thinking", thinking: "beyond block capacity" },
  ]).result();
  const r = new Previews();
  r.update({ type: "start", id: "r", loop: "l", session: "s" });
  for (let i = 0; i < 128; i++)
    r.update({
      type: "event",
      id: "r",
      event: { type: "text_end", contentIndex: i, content: "x", partial: many },
    });
  r.update({
    type: "event",
    id: "r",
    event: {
      type: "thinking_end",
      contentIndex: 128,
      content: "beyond block capacity",
      partial: many,
    },
  });
  assert.equal(r.snapshot("s", true)[0].blocks.length, 128);
  assert.deepEqual(r.snapshot("s", false)[0].thinking_preview, {
    text: "beyond block capacit…",
    truncated: true,
  });
});

test("normal, mixed, unknown and legacy durable replies retain outcome and hidden reasoning boundaries", () =>
  fixture(async (f) => {
    for (const [reason, expected] of [
      ["stop", "completed"],
      ["toolUse", "continued"],
      ["length", "truncated"],
      ["error", "failed"],
      ["aborted", "interrupted"],
      ["future", "unknown"],
    ]) {
      const item = record(
        f,
        [
          { type: "thinking", thinking: " reasoning " },
          { type: "text", text: "body" },
        ],
        reason,
      );
      const page: any = await f.client.query(
        "timeline/around?event_id=" + item.event.event_id,
      );
      const row = page.items.find((r: any) => r.id === item.message);
      assert.equal(row.outcome, expected);
      assert.equal(row.text, "body");
      assert.equal(row.thinking, undefined);
      assert.deepEqual(row.thinking_preview, {
        text: " reasoning ",
        truncated: false,
      });
    }
    const legacy = f.app.store.event(
      "main.message",
      { role: "assistant", content: [{ type: "text", text: "old" }] },
      scope(f),
    );
    f.app.store.commit([], [legacy]);
    const row: any = await f.client.query(
      "messages/" + legacy.event_id + "/content",
    );
    assert.equal(row.outcome, "unknown");
    assert.equal(row.text, "old");
    assert.equal(row.incomplete, false);
  }));
