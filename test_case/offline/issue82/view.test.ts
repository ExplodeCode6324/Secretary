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
      const start =
        p === "timeline/around"
          ? Math.max(0, Number(u.searchParams.get("message_id")) - 25)
          : u.searchParams.has("cursor")
            ? Number(u.searchParams.get("cursor"))
            : messages.length - 50;
      value = {
        items: messages.slice(start, start + 50),
        after: start + 50 < messages.length ? String(start + 50) : null,
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
