import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  Timeline,
  timelineFor,
  PAGE_BYTES,
  FRAGMENT_BYTES,
} from "../../../src/pi_secretary/src/timeline.ts";
import { base, id, revise } from "../../../src/pi_secretary/src/store.ts";
import { serve } from "../../../src/pi_secretary/src/backend.ts";
import { api } from "../../../src/pi_secretary/src/ui-client.ts";
import { activityHistoryFor } from "../../../src/pi_secretary/src/activity-history.ts";
import type {
  CompactionJob,
  ModelCall,
} from "../../../src/pi_secretary/src/contracts.ts";
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "secretary-window-"));
function seed(app: App, count: number, long = false) {
  const expected: { id: string; order: number }[] = [];
  const scope = {
    session_id: app.host.sessionID,
    task_id: null,
    execution_id: null,
  };
  for (let i = 0; i < count; i += 100) {
    const length = Math.min(100, count - i);
    const events = Array.from({ length }, (_, j) =>
      app.store.event(
        "main.message",
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: long
                ? "中😀\u0001<script>".repeat(20000)
                : "synthetic " + (i + j),
            },
          ],
        },
        scope,
      ),
    );
    const job: CompactionJob = {
      schema_version: 1,
      record_type: "CompactionJob",
      ...base(),
      state: "COMMITTED",
      session_id: scope.session_id,
      base_revision: 1,
      source_event_ids: [],
      source_refs: [app.store.put({ synthetic: true })],
      candidate_ref: null,
      covered_event_ids: [],
      validation_errors: [],
    };
    app.store.commit([job], events);
    expected.push(
      { id: "compaction:" + job.id, order: app.store.sequence * 1000 + 50 },
      ...events.map((e, index) => ({
        id: e.event_id,
        order:
          app.store.sequence * 1000 + 500 + (index / (events.length + 1)) * 100,
      })),
    );
  }
  return expected;
}
async function cacheModule() {
  const source = fs.readFileSync(
    new URL(
      "../../../src/pi_secretary/web/timeline-window.js",
      import.meta.url,
    ),
    "utf8",
  );
  return import(
    "data:text/javascript;base64," + Buffer.from(source).toString("base64")
  );
}

test("unified pages match independent mixed-history oracle in both directions and locate", async () => {
  const dir = temp(),
    app = await App.open(dir);
  try {
    const expected = seed(app, 1200),
      history = timelineFor(app),
      session = app.host.sessionID;
    const latest = app.store.select<CompactionJob>(
      "CompactionJob",
      () => true,
      1,
      0,
      { latest: true },
    );
    assert.equal(
      "compaction:" + latest[0].id,
      expected.filter((x) => x.id.startsWith("compaction:")).at(-1)!.id,
    );
    latest[0].state = "FAILED";
    assert.equal(
      app.store.get<CompactionJob>("CompactionJob", latest[0].id).state,
      "COMMITTED",
    );
    let page: any = history.query(session),
      actual: string[] = page.items.map((x: any) => x.id),
      first = page;
    while (page.before) {
      page = history.query(session, {
        cursor: page.before,
        direction: "before",
      });
      actual.unshift(...page.items.map((x: any) => x.id));
    }
    assert.deepEqual(
      actual,
      expected.map((x) => x.id),
    );
    const forward = page.items.map((x: any) => x.id);
    while (page.after) {
      page = history.query(session, { cursor: page.after, direction: "after" });
      forward.push(...page.items.map((x: any) => x.id));
    }
    assert.deepEqual(forward, actual);
    for (const index of [0, 99, 700, expected.length - 1])
      assert(
        history
          .query(session, { locate: expected[index].id })
          .items.some((x: any) => x.id === expected[index].id),
      );
    const updated = seed(app, 1);
    history.sync();
    assert(
      history
        .query(session, {
          cursor: first.items.at(-1).cursor,
          direction: "after",
        })
        .items.some((x: any) => updated.some((e) => e.id === x.id)),
    );
    assert.throws(() => history.query(id(), { cursor: first.before }), /RESET/);
    assert.throws(
      () => history.query(session, { cursor: first.before, thinking: true }),
      /RESET/,
    );
    assert.throws(() => history.query(session, { limit: 201 }), /LIMIT/);
    assert.equal(history.query(id()).items.length, 0);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("page bytes and lossless UTF-8 body fragments are bounded without caching full bodies", async () => {
  const dir = temp(),
    app = await App.open(dir);
  try {
    const expected = seed(app, 30, true),
      history = timelineFor(app),
      session = app.host.sessionID;
    const page = history.query(session, { thinking: true });
    assert(Buffer.byteLength(JSON.stringify(page)) <= PAGE_BYTES);
    const key = expected[1].id;
    let text = "",
      offset = 0;
    do {
      const fragment = history.query(session, {
        fragment: key,
        textOffset: offset,
        thinking: true,
      }).items[0];
      assert(Buffer.byteLength(JSON.stringify(fragment)) < FRAGMENT_BYTES);
      text += fragment.text;
      offset += fragment.text.length;
      if (offset === fragment.textLength) break;
    } while (offset < 1000000);
    assert.equal(text, "中😀\u0001<script>".repeat(20000));
    const backwards = history.query(session, { fragment: key, textOffset: 2 })
      .items[0];
    assert.equal(backwards.textOffset, 1);
    assert(backwards.text.startsWith("😀"));
    assert.equal(Buffer.from(backwards.text).toString(), backwards.text);
    assert(history.diagnostics().fragment_bytes <= 4 * 1024 * 1024);
    assert(history.diagnostics().fragment_count <= 128);
    assert.throws(
      () => history.query(session, { fragment: key, textOffset: -1 }),
      /OFFSET/,
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("late activity insertion refreshes loaded range and process generation invalidates cursors", async () => {
  const dir = temp(),
    app = await App.open(dir);
  try {
    app.host.accept("synthetic");
    await app.host.drain();
    seed(app, 250);
    const history = timelineFor(app),
      session = app.host.sessionID;
    const page: any = history.query(session, {
      locate: activityHistoryFor(app.store).page(session).items.at(-1)!.id,
    });
    const call = app.store.all<ModelCall>("ModelCall")[0];
    const late = revise(call, {
      response: app.store.put({
        content: [
          {
            type: "toolCall",
            id: id(),
            name: "memory_read",
            arguments: { source: "consciousness" },
          },
        ],
      }),
    });
    app.store.commit([late]);
    history.sync();
    const delta: any = history.query(session, {
      since: page.revision,
      generation: page.generation,
      lower: page.items[0].cursor,
      upper: page.items.at(-1).cursor,
    });
    assert(delta.items.some((m: any) => m.activity?.kind === "tool"));
    assert(delta.items.some((m: any) => m.order < page.items.at(-1).order));
    seed(app, 4200);
    history.sync();
    assert.equal(
      (
        history.query(session, {
          since: page.revision,
          generation: page.generation,
        }) as any
      ).reset,
      undefined,
    );
    const rebuilt = new Timeline(app);
    rebuilt.sync();
    assert.throws(
      () => rebuilt.query(session, { cursor: page.items[0].cursor }),
      /RESET/,
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cache scrolls 6000 items both ways, shares activity quota, enforces bytes and preserves protected anchor", async () => {
  const { TimelineWindow, bytes } = await cacheModule();
  const w = new TimelineWindow();
  const page = (start: number, text = "x") => ({
    items: Array.from({ length: 200 }, (_, j) => ({
      id: String(start + j),
      order: start + j,
      revision: 1,
      kind: j % 2 ? "message" : "activity",
      text,
      cursor: String(start + j),
    })),
    before: String(start),
    after: String(start + 199),
  });
  for (let start = 0; start < 6000; start += 200) {
    assert(w.apply(page(start)));
    assert(w.items.length <= 2000);
    assert(w.bytes <= 16 * 1024 * 1024);
  }
  assert.equal(w.items[0].id, "4000");
  for (let start = 3800; start >= 0; start -= 200) {
    assert(w.apply(page(start), "before"));
    assert(w.items.length <= 2000);
  }
  assert.equal(w.items[0].id, "0");
  assert.equal(w.items.at(-1).id, "1999");
  assert(!w.apply(page(2000), "after", new Set(["0"])));
  assert.equal(w.items[0].id, "0");
  for (let i = 2000; i < 10000; i += 200) {
    assert(w.apply(page(i, "x".repeat(4000))));
    assert(w.bytes <= 16 * 1024 * 1024);
  }
  assert.equal(
    w.bytes,
    w.items.reduce((n: number, m: any) => n + bytes(m), 0),
  );
  assert.throws(() => w.apply(page(0, "x".repeat(6000))), /预算/);
  const previous = w.items[0];
  w.apply({
    items: [{ ...previous, revision: 0, text: "stale" }],
    before: w.before,
    after: w.after,
  });
  assert.notEqual(w.items[0].text, "stale");
});

test("window state avoids legacy body reads, authenticated API bounds requests and keeps old API", async () => {
  const dir = temp(),
    app = await App.open(dir);
  seed(app, 300);
  const server = await serve(app);
  try {
    const client = (await api(server.endpoint, "/api/client", {})).client;
    timelineFor(app);
    let reads = 0;
    const read = app.store.read.bind(app.store);
    app.store.read = ((ref) => {
      reads++;
      return read(ref);
    }) as typeof read;
    const state = await api(
      server.endpoint,
      `/api/state?client=${client}&window=1`,
    );
    assert(!("messages" in state));
    assert.equal(state.tasks.length, 0);
    assert(reads < 10);
    app.store.read = read;
    const page = await api(server.endpoint, "/api/timeline", {
      client,
      options: {},
    });
    assert(page.items.length <= 200);
    assert(Buffer.byteLength(JSON.stringify(page)) <= PAGE_BYTES);
    assert.equal(
      (
        await fetch(server.endpoint.url + "/api/timeline", {
          method: "POST",
          body: JSON.stringify({ client, options: {} }),
        })
      ).status,
      401,
    );
    const normal = await api(server.endpoint, `/api/state?client=${client}`);
    assert.equal(normal.messages.length, 300);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("idle and loaded-range polling read no old bodies; task children and authorization stay session scoped", async () => {
  const { fixtureModel, replyStream } =
    await import("../../../src/pi_secretary/src/model.ts");
  const dir = temp(),
    app = await App.open(dir, {
      main: {
        model: fixtureModel,
        stream: () => replyStream([{ type: "text", text: "synthetic" }]),
      },
      task: {
        model: fixtureModel,
        stream: () =>
          replyStream([
            {
              type: "toolCall",
              id: id(),
              name: "bash",
              arguments: { command: "NEVER_EXECUTE_SYNTHETIC" },
            },
          ]),
      },
    });
  try {
    const expected = seed(app, 300),
      history = timelineFor(app),
      session = app.host.sessionID;
    const page: any = history.query(session);
    let reads = 0;
    const read = app.store.read.bind(app.store);
    app.store.read = ((ref) => {
      reads++;
      return read(ref);
    }) as typeof read;
    for (let i = 0; i < 100; i++) {
      history.sync();
      assert.equal(
        history.query(session, {
          generation: page.generation,
          since: page.revision,
          lower: page.items[0].cursor,
          upper: page.items.at(-1).cursor,
        }).items.length,
        0,
      );
    }
    assert.equal(reads, 0);
    app.store.read = read;
    app.scheduler.propose("synthetic approval", id(), session);
    app.scheduler.tick();
    await app.scheduler.idle();
    history.sync();
    const taskPage = history.query(session);
    const tools = taskPage.items.filter(
      (m: any) => m.activity?.kind === "tool",
    );
    assert.equal(tools.length, 1);
    assert.equal(tools[0].activity.status, "waiting");
    assert.equal(history.query(id()).items.length, 0);
    reads = 0;
    app.store.read = ((ref) => {
      reads++;
      return read(ref);
    }) as typeof read;
    const unchangedHistory = history.query(session, {
      since: page.revision,
      generation: page.generation,
      lower: page.items[0].cursor,
      upper: page.items.at(-1).cursor,
    });
    assert.equal(unchangedHistory.items.length, 0);
    assert.equal(reads, 0);
    app.store.read = read;
    assert(
      history.query(session, { locate: expected[30].id }).items.length > 0,
    );
    const server = await serve(app);
    try {
      const client = (await api(server.endpoint, "/api/client", {})).client;
      const approvals = await api(
        server.endpoint,
        `/api/panels?client=${client}&kind=approvals`,
      );
      assert.equal(approvals.items.length, 1);
      assert.equal(approvals.items[0].state, "PENDING");
    } finally {
      await server.close();
    }
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("content budget evicts large UTF-8 entries before the count limit", async () => {
  const { TimelineWindow } = await cacheModule();
  const window = new TimelineWindow();
  for (let start = 0; start < 3000; start += 50) {
    const items = Array.from({ length: 50 }, (_, j) => ({
      id: String(start + j),
      order: start + j,
      revision: 1,
      kind: "message",
      text: "中".repeat(4000),
      cursor: String(start + j),
    }));
    assert(window.apply({ items, before: String(start), after: null }));
    assert(window.bytes <= 16 * 1024 * 1024);
  }
  assert(window.items.length < 2000);
  assert(window.items.length > 1000);
  assert(window.before);
  assert.equal(window.items.at(-1).id, "2999");
});

test("an initially empty client receives another client's first messages through its bounded delta", async () => {
  const dir = temp(),
    app = await App.open(dir);
  try {
    const history = timelineFor(app),
      session = app.host.sessionID,
      empty = history.query(session);
    assert.equal(empty.items.length, 0);
    app.host.accept("synthetic first message from another client");
    await app.host.drain();
    history.sync();
    const delta = history.query(session, {
      generation: empty.generation,
      since: empty.revision,
      tail: true,
    });
    assert(delta.items.some((m: any) => m.role === "master"));
    assert(delta.items.some((m: any) => m.role === "secretary"));
    assert(delta.items.length <= 200);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
