import test from "node:test";
import assert from "node:assert/strict";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import {
  DocumentView,
  AnchoredScroll,
  safeText,
  messageComponent,
} from "../../../src/pi_secretary/src/tui/view.ts";
import { RemoteViews } from "../../../src/pi_secretary/src/tui/remote.ts";
import { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import type { Message } from "../../../src/pi_secretary/src/api/contracts.ts";

test("reading anchor survives new arrivals and reflow without following the tail", () => {
  const doc = new DocumentView(),
    scroll = new AnchoredScroll(doc);
  doc.entries = Array.from({ length: 50 }, (_, i) => ({
    id: String(i),
    version: "1",
    component: new Text(`message ${i} ` + "word ".repeat(40), 0, 0),
  }));
  let lines = doc.render(80);
  scroll.updateLayout(lines.length, 10, () => {});
  scroll.scrollTo(60);
  const before = scroll.scrollTop;
  doc.entries.push({
    id: "50",
    version: "1",
    component: new Text("new arrival", 0, 0),
  });
  lines = doc.render(80);
  scroll.updateLayout(lines.length, 10, () => {});
  assert.equal(scroll.scrollTop, before);
  const stable = lines[scroll.scrollTop].match(/message \d+/)?.[0];
  lines = doc.render(40);
  scroll.updateLayout(lines.length, 10, () => {});
  if (stable)
    assert(
      lines
        .slice(scroll.scrollTop, scroll.scrollTop + 2)
        .join("")
        .includes(stable),
    );
  assert(scroll.scrollTop < lines.length - 10);
  assert.equal(safeText("ok\x1b[31m red\x1b[0m\x07"), "ok red");
});
const message = (i: number): Message => ({
  id: String(i),
  kind: "message",
  persistence: "durable",
  revision: "1",
  role: "assistant",
  text: `message ${i}`,
  call_id: null,
  incomplete: false,
  next_cursor: null,
});
test("initial window stays bounded; bursts larger than 50 catch up without dropping in-run arrivals", async () => {
  let messages = Array.from({ length: 100 }, (_, i) => message(i));
  const client = new CoreClient({
    api_version: "1",
    url: "http://127.0.0.1:1",
    token: "unused",
    pid: 1,
    instance_id: "i",
    data_domain_id: "d",
  });
  client.query = async <T>(route: string) => {
    const u = new URL(route, "http://test/"),
      p = u.pathname.slice(1);
    let value: unknown;
    if (p === "tasks" || p === "scopes")
      value = { items: [], next_cursor: null, version: "1" };
    else {
      const limit = Number(u.searchParams.get("limit") ?? 50);
      const start =
        p === "timeline/around"
          ? Number(u.searchParams.get("message_id"))
          : u.searchParams.has("cursor")
            ? Number(u.searchParams.get("cursor"))
            : messages.length - 50;
      value = {
        items: messages.slice(start, start + limit),
        after: start + limit < messages.length ? String(start + limit) : null,
        before: null,
        version: "1",
        generation: "1",
      };
    }
    return value as T;
  };
  const views = new RemoteViews(client);
  await views.refresh();
  assert.equal(views.messages.size, 50);
  assert(!views.messages.has("0"));
  messages.push(...Array.from({ length: 140 }, (_, i) => message(i + 100)));
  await views.refresh();
  assert.equal(views.messages.size, 190);
  assert.deepEqual(
    [...views.messages.keys()],
    Array.from({ length: 190 }, (_, i) => String(i + 50)),
  );
  views.stop();
});

test("long Chinese previews and labels wrap in narrow terminals", () => {
  const m = message(1);
  m.thinking_preview = { text: "中文思考预览".repeat(60), truncated: false };
  m.outcome = "interrupted";
  const view = messageComponent(m);
  for (const width of [2, 8, 40, 100])
    for (const line of view.render(width))
      assert(
        visibleWidth(line) <= width,
        `width ${width}: ${visibleWidth(line)}`,
      );
});

test("transient updates skip Task/Scope reads and preserve assembled fragments; failed Task page retains its cursor", async () => {
  const client = new CoreClient({
    api_version: "1",
    url: "http://127.0.0.1:1",
    token: "unused",
    pid: 1,
    instance_id: "i",
    data_domain_id: "d",
  });
  const { until } = await import("../issue9/helpers.ts");
  const reads: string[] = [];
  let controller!: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>;
  client.syncCursor = async () => ({
    cursor: "c",
    sequence: "1",
    instance_id: "i",
  });
  client.stream = async (_cursor, signal) =>
    new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(c) {
        controller = c;
        signal?.addEventListener("abort", () => c.close(), { once: true });
      },
    });
  const first = { ...message(1), text: "first ", next_cursor: "fragment" };
  client.query = async <T>(route: string) => {
    reads.push(route);
    if (route.startsWith("tasks?")) {
      if (route.includes("cursor=")) throw Error("PAGE_UNAVAILABLE");
      return { items: [], next_cursor: "next", version: "1" } as T;
    }
    if (route.startsWith("scopes?"))
      return { items: [], next_cursor: null, version: "1" } as T;
    if (route.startsWith("messages/"))
      return { ...first, text: "second", next_cursor: null } as T;
    return {
      items: [first],
      after: null,
      before: null,
      version: "1",
      generation: "1",
    } as T;
  };
  const views = new RemoteViews(client);
  try {
    await views.start();
    views.focus(["1"]); // #91 loads complete bodies when their rows enter the viewport.
    await until(() => views.messages.get("1")?.next_cursor === null);
    const assembled = views.messages.get("1");
    const initial = reads.length;
    controller.enqueue(
      new TextEncoder().encode("event: transient\ndata: {}\n\n"),
    );
    await until(() => reads.length > initial);
    await views.refresh([]);
    assert.equal(views.messages.get("1"), assembled);
    assert.equal(views.messages.get("1")?.text, "first second");
    assert.equal(reads.filter((r) => r.startsWith("messages/")).length, 1);
    assert.equal(reads.filter((r) => r.startsWith("tasks?")).length, 1);
    assert.equal(reads.filter((r) => r.startsWith("scopes?")).length, 1);
    controller.enqueue(
      new TextEncoder().encode(
        'event: change\ndata: {"changes":[{"kind":"invalidate","query":"tasks/one","resource_type":"tasks"}]}\n\n',
      ),
    );
    await until(() => reads.filter((r) => r.startsWith("tasks?")).length === 2);
    assert.equal(reads.filter((r) => r.startsWith("scopes?")).length, 1);
    const old = views.tasks;
    assert.equal(await views.page("next"), false);
    assert.equal(views.tasks, old);
    assert.equal(views.taskCursor, undefined);
  } finally {
    views.stop();
  }
});

test("reconnect uses durable fallback and requires deliberate navigation after every locator disappears", async () => {
  const makeClient = (instance_id: string) =>
    new CoreClient({
      api_version: "1",
      url: "http://127.0.0.1:1",
      token: "unused",
      pid: 1,
      instance_id,
      data_domain_id: "d",
    });
  const previous = new RemoteViews(makeClient("old"));
  previous.history.items.set("0", message(0));
  previous.history.items.set("1", { ...message(1), persistence: "transient" });
  const client = makeClient("new"),
    views = new RemoteViews(client);
  views.inherit(previous);
  let window = [message(2)];
  const locators: string[] = [];
  client.query = async <T>(route: string) => {
    if (route.startsWith("tasks?") || route.startsWith("scopes?"))
      return { items: [], next_cursor: null, version: "1" } as T;
    if (route.startsWith("timeline/around")) {
      const anchor = new URL(route, "http://test").searchParams.get(
        "message_id",
      )!;
      locators.push(anchor);
      if (anchor === "0") throw Error("TIMELINE_ITEM_NOT_FOUND");
    }
    return {
      items: window,
      after: null,
      before: null,
      version: "1",
      generation: "new",
    } as T;
  };
  await views.refresh();
  assert.deepEqual(locators, ["0"]);
  assert.deepEqual([...views.messages.keys()], ["0"]);
  assert.match(views.notices.get("0")!, /不可用/);
  assert.equal(views.history.unavailable, true);
  window = [message(2), message(3)];
  await views.refresh();
  assert(!views.messages.has("3")); // Passive SSE must not move the reading position.
  await views.historyPage("after");
  assert(views.messages.has("3"));
  assert(!locators.includes("1"));
  assert.equal(views.error, "");
  views.stop();
  previous.stop();
});
