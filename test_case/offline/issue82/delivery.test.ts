import { plainSnapshot } from "../../../src/pi_secretary/src/tui/draft.ts";
import test from "node:test";
import http from "node:http";
import { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import assert from "node:assert/strict";
import {
  Delivery,
  type DeliveryClient,
} from "../../../src/pi_secretary/src/tui/delivery.ts";
import {
  freshState,
  type LocalState,
  type StatePersistence,
  type Pending,
} from "../../../src/pi_secretary/src/tui/state.ts";
import { TerminalApp } from "../../../src/pi_secretary/src/tui/app.ts";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import type { Receipt } from "../../../src/pi_secretary/src/api/contracts.ts";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
class MemoryFiles implements StatePersistence {
  saved: LocalState[] = [];
  recovered: Pending[] = [];
  delay = 0;
  fail = false;
  async save(s: LocalState) {
    const snapshot = structuredClone(s);
    if (this.delay) await sleep(this.delay);
    if (this.fail) throw Error("DISK_FAILED");
    this.saved.push(snapshot);
  }
  async recover(p: Pending) {
    this.recovered.push(structuredClone(p));
    return "recovery-test.json";
  }
}
function receipt(id: string): Receipt {
  return {
    request_id: id,
    command: "messages",
    acceptance: "ACCEPTED",
    state: "ACCEPTED",
    revision: "1",
    resource_ids: [],
    error_code: null,
  };
}
function fake() {
  const endpoint = {
    api_version: "1" as const,
    url: "http://127.0.0.1:1",
    token: "unused",
    pid: 1,
    instance_id: "instance-a",
    data_domain_id: "domain",
  };
  const accepted = new Map<string, Receipt>(),
    posts: { request_id: string; text: string }[] = [];
  let queryDelay = 0,
    postDelay = 0,
    postError = "",
    getError = "";
  const client: DeliveryClient = {
    endpoint,
    core: async () => ({
      api_version: "1",
      data_domain_id: "domain",
      owner_id: "domain",
      mode: "fixture",
      instance_id: endpoint.instance_id,
      session_id: "s",
      state: "RUNNING",
      capabilities: {},
    }),
    query: async <T>(route: string) => {
      await sleep(queryDelay);
      if (getError) throw Error(getError);
      const r = accepted.get(route.split("/")[1]);
      if (!r) throw Error("NOT_FOUND");
      return { receipt: r } as T;
    },
    command: async (_route, body) => {
      posts.push(structuredClone(body) as { request_id: string; text: string });
      await sleep(postDelay);
      if (postError) throw Error(postError);
      const r = receipt(body.request_id);
      accepted.set(body.request_id, r);
      return r;
    },
    syncCursor: async () => ({
      cursor: "cursor-a",
      sequence: "1",
      instance_id: endpoint.instance_id,
    }),
    changes: async () => ({
      transactions: [],
      next_cursor: "cursor-a",
      has_more: false,
    }),
  };
  return {
    client,
    accepted,
    posts,
    set: (o: {
      queryDelay?: number;
      postDelay?: number;
      postError?: string;
      getError?: string;
    }) => {
      queryDelay = o.queryDelay ?? queryDelay;
      postDelay = o.postDelay ?? postDelay;
      postError = o.postError ?? postError;
      getError = o.getError ?? getError;
    },
  };
}
function pending(raw = "/rawmessage /T", text = "/T"): Pending {
  return {
    id: "original",
    raw,
    body: { request_id: "original", text },
    created_at: new Date().toISOString(),
    attempts: ["instance-a"],
    cursor: "cursor-a",
    status: "UNKNOWN",
  };
}

test("dedicated latency: 2-second reconciliation does not block actual terminal editing/navigation; settles without a new ID", async () => {
  const f = fake(),
    files = new MemoryFiles(),
    s = freshState("domain", "fixture"),
    p = pending();
  s.pending = p;
  f.accepted.set(p.id, receipt(p.id));
  f.set({ queryDelay: 2000 });
  const d = new Delivery(s, files);
  await d.connect(f.client);
  const terminal = new VirtualTerminal(100, 30),
    app = new TerminalApp("unused", terminal);
  app.delivery = d;
  d.onChange = () => app.draw();
  app.editors.Main.enabled = app.editors.Task.enabled = true;
  app.tui.start();
  app.draw();
  const events: { type: string; at: number }[] = [];
  d.onEvent = (e) => events.push(e);
  const check = d.reconcile(true);
  const times: number[] = [];
  try {
    for (let i = 0; i < 10; i++) {
      const begin = performance.now();
      terminal.sendInput("x");
      await sleep(20);
      await terminal.flush();
      assert(app.editors.Main.getExpandedText().endsWith("x"));
      assert(terminal.getViewport().join("\n").includes("x"));
      times.push(performance.now() - begin);
    }
    app.editors.Main.restore(plainSnapshot("/T", "typed"));
    d.edit("Main", "/T");
    const start = performance.now();
    app.editors.Main.onExplicitSubmit?.("/T", plainSnapshot("/T", "typed"));
    await sleep(20);
    await terminal.flush();
    const navigation = performance.now() - start;
    assert.equal(app.page, "Task");
    assert(terminal.getViewport().join("\n").includes("Task"));
    assert(Math.max(...times) < 100, `input max ${Math.max(...times)}`);
    assert(navigation < 100, `navigation ${navigation}`);
    assert(s.pending, "status must still be waiting while interaction works");
    await check;
    assert.equal(s.pending, undefined);
    assert.equal(f.posts.length, 0);
    const elapsed =
      events.find((x) => x.type === "reconcile-end")!.at -
      events.find((x) => x.type === "reconcile-start")!.at;
    console.log(
      JSON.stringify({
        scenario: "status-2000ms",
        input_ms: times,
        navigation_ms: navigation,
        status_ms: elapsed,
      }),
    );
  } finally {
    await app.close();
  }
});
test("slow durable save and delayed POST keep editing alive and never clear a newer draft", async () => {
  const f = fake(),
    files = new MemoryFiles();
  files.delay = 150;
  f.set({ postDelay: 250 });
  const s = freshState("domain", "fixture"),
    d = new Delivery(s, files);
  await d.connect(f.client);
  d.edit("Main", "original");
  const send = d.submit("original", "original");
  await sleep(20);
  d.edit("Main", "new text");
  await send;
  assert.equal(s.drafts.Main.raw, "new text");
  assert.equal(f.posts.length, 1);
  assert.equal(s.pending, undefined);
  assert(files.saved.some((v) => v.pending?.attempts.includes("instance-a")));
  await d.close();
});
test("unknown request retries immutable identity; conflict and newer text cannot become a fresh ID", async () => {
  const f = fake(),
    files = new MemoryFiles(),
    s = freshState("domain", "fixture");
  s.pending = pending();
  const d = new Delivery(s, files);
  await d.connect(f.client);
  await d.submit("new", "new");
  assert.equal(f.posts.length, 0);
  assert(s.pending);
  f.set({ postError: "REQUEST_CONFLICT" });
  await d.submit("/rawmessage /T", "/T");
  assert.equal(f.posts[0].request_id, "original");
  assert.equal(s.pending?.status, "CONFLICT");
  f.accepted.set("original", receipt("original"));
  await d.reconcile();
  assert.equal(s.pending?.status, "CONFLICT");
  await d.submit("/rawmessage /T", "/T");
  assert.equal(f.posts.length, 1);
  await d.close();
});
test("reconcile-before-restore preserves raw syntax; late acceptance atomically removes bound copy and cannot fall through", async () => {
  const f = fake(),
    files = new MemoryFiles(),
    s = freshState("domain", "fixture");
  s.pending = pending();
  const d = new Delivery(s, files);
  await d.connect(f.client);
  await d.reconcile(true);
  assert.equal(s.drafts.Main.raw, "/rawmessage /T");
  assert.equal(s.drafts.Main.binding, "original");
  f.accepted.set("original", receipt("original"));
  await d.submit(s.drafts.Main.raw, "/T");
  assert.equal(s.pending, undefined);
  assert.equal(s.drafts.Main.raw, "");
  assert.equal(f.posts.length, 0);
  assert(
    files.saved.some(
      (x) => x.pending?.status === "ACCEPTED" && x.drafts.Main.raw === "",
    ),
  );
  await d.close();
});
test("same-instance negative read never releases; verified later-instance with cursor does; missing continuity stays unknown", async () => {
  const f = fake(),
    files = new MemoryFiles(),
    s = freshState("domain", "fixture");
  s.pending = pending();
  s.drafts.Main.raw = "newer";
  const d = new Delivery(s, files);
  await d.connect(f.client);
  await d.reconcile();
  assert(s.pending);
  f.client.endpoint.instance_id = "instance-b";
  await d.connect(f.client);
  await d.reconcile();
  assert.equal(s.pending, undefined);
  assert.equal(s.drafts.Main.raw, "newer");
  assert.equal(files.recovered[0].raw, "/rawmessage /T");
  s.pending = pending();
  s.pending.cursor = undefined;
  await d.reconcile();
  assert(s.pending);
  await d.close();
});
test("rejection race and disk error retain original plus newer text; no network before durable attempt", async () => {
  const f = fake(),
    files = new MemoryFiles(),
    s = freshState("domain", "fixture"),
    d = new Delivery(s, files);
  await d.connect(f.client);
  d.edit("Main", "original");
  files.fail = true;
  await d.submit("original", "original");
  assert.equal(f.posts.length, 0);
  assert.equal(s.pending?.raw, "original");
  files.fail = false;
  f.set({ postDelay: 50, postError: "INVALID_INPUT" });
  const send = d.submit("original", "original");
  await sleep(10);
  d.edit("Main", "newer");
  await send;
  assert.equal(s.drafts.Main.raw, "newer");
  assert.equal(files.recovered[0].raw, "original");
  assert.equal(s.pending, undefined);
  await d.close();
});

test("real HTTP: lost POST receipt, bounded slow status and later acceptance never create a duplicate", async () => {
  let accepted: Receipt | undefined;
  let posts = 0;
  let slow = true;
  const server = http.createServer((req, res) => {
    if (req.url === "/api/v1/core")
      res.end(
        JSON.stringify({
          data: {
            api_version: "1",
            data_domain_id: "domain",
            mode: "fixture",
            instance_id: "instance-a",
          },
        }),
      );
    else if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        posts++;
        accepted = receipt(JSON.parse(body).request_id);
        req.socket.destroy();
      });
    } else if (req.url?.startsWith("/api/v1/requests/")) {
      const timer = setTimeout(
        () => res.end(JSON.stringify({ data: { receipt: accepted } })),
        slow ? 2200 : 10,
      );
      res.on("close", () => clearTimeout(timer));
    } else
      res.end(
        JSON.stringify({
          data: {
            cursor: "cursor-a",
            sequence: "1",
            instance_id: "instance-a",
          },
        }),
      );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as import("node:net").AddressInfo).port;
  const client = new CoreClient({
    api_version: "1",
    url: `http://127.0.0.1:${port}`,
    token: "unused",
    pid: 1,
    instance_id: "instance-a",
    data_domain_id: "domain",
  });
  const s = freshState("domain", "fixture"),
    d = new Delivery(s, new MemoryFiles());
  try {
    await d.connect(client);
    d.edit("Main", "body");
    await d.submit("body", "body");
    assert(s.pending);
    assert.equal(posts, 1);
    const original = s.pending.id;
    const start = performance.now();
    await d.reconcile();
    const elapsed = performance.now() - start;
    assert(elapsed >= 1900 && elapsed < 3000, `status abort ${elapsed}`);
    assert.equal(s.pending?.id, original);
    assert.equal(d.busy, false);
    slow = false;
    await d.reconcile();
    assert.equal(s.pending, undefined);
    assert.equal(posts, 1);
    console.log(
      JSON.stringify({
        scenario: "HTTP-lost-receipt-delayed-status",
        status_timeout_ms: elapsed,
        posts,
      }),
    );
  } finally {
    await d.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("graceful exit freezes input during its durable checkpoint; failure re-enables editing", async () => {
  const files = new MemoryFiles();
  files.delay = 30;
  const s = freshState("domain", "fixture"),
    d = new Delivery(s, files);
  const app = new TerminalApp("unused", new VirtualTerminal());
  app.delivery = d;
  app.editors.Main.enabled = true;
  d.edit("Main", "saved");
  app.draw();
  files.fail = true;
  await app.close();
  assert.equal(app.editors.Main.enabled, true);
  files.fail = false;
  const closing = app.close();
  app.editors.Main.handleInput("late");
  await closing;
  assert.equal(s.drafts.Main.raw, "saved");
  assert.equal(app.editors.Main.getExpandedText(), "saved");
  assert.equal(files.saved.at(-1)?.drafts.Main.raw, "saved");
});

test("same-instance unknown restores raw once; coalesced reads retain restore intent and late acceptance clears without POST", async () => {
  const f = fake(),
    s = freshState("domain", "fixture"),
    d = new Delivery(s, new MemoryFiles());
  await d.connect(f.client);
  f.set({ postError: "INTERNAL_ERROR", queryDelay: 40 });
  d.edit("Main", "/rawmessage /T");
  await d.submit("/rawmessage /T", "/T");
  await d.reconcile();
  assert.equal(s.drafts.Main.raw, "/rawmessage /T");
  assert.equal(s.drafts.Main.binding, s.pending?.id);
  // Explicit retry keeps its bound draft visible even if it also fails.
  await d.submit(s.drafts.Main.raw, "/T");
  await d.reconcile();
  assert.equal(s.drafts.Main.raw, "/rawmessage /T");
  assert.equal(f.posts.length, 2);
  const id = s.pending!.id;
  f.accepted.set(id, receipt(id));
  await d.reconcile();
  assert.equal(s.drafts.Main.raw, "");
  assert.equal(s.pending, undefined);
  assert.equal(f.posts.length, 2);
  s.pending = pending();
  const reading = d.reconcile(false);
  const restoring = d.reconcile(true);
  await Promise.all([reading, restoring]);
  assert.equal(s.drafts.Main.binding, "original");
  d.edit("Main", "");
  await d.reconcile(true);
  assert.equal(s.drafts.Main.raw, "", "a deliberate clear is not undone");
  await d.close();
});

test("reconnect restore intent survives an old-client read already in flight", async () => {
  const old = fake(),
    next = fake(),
    s = freshState("domain", "fixture"),
    d = new Delivery(s, new MemoryFiles());
  s.pending = pending();
  old.set({ queryDelay: 40 });
  await d.connect(old.client);
  const reading = d.reconcile();
  await d.connect(next.client);
  await Promise.all([reading, d.reconcile(true)]);
  assert.equal(s.drafts.Main.binding, "original");
  assert.equal(next.posts.length, 0);
  await d.close();
});

test("cursor movement preserves errors; an ordinary edit clears the transient hint", async () => {
  const d = new Delivery(freshState("domain", "fixture"), new MemoryFiles());
  const app = new TerminalApp("unused", new VirtualTerminal());
  app.delivery = d;
  app.editors.Main.enabled = true;
  d.edit("Main", "/unknown");
  app.draw();
  app.editors.Main.handleInput("\x1b[13;2u");
  assert.match(app.footer.render(160).join(""), /未知/);
  app.editors.Main.handleInput("\x1b[D");
  assert.match(app.footer.render(160).join(""), /未知/);
  app.editors.Main.handleInput("x");
  assert.doesNotMatch(app.footer.render(160).join(""), /未知/);
  await app.close();
});

test("newer draft defers rather than consumes the one restore; clearing it allows read-only recovery", async () => {
  const f = fake(),
    s = freshState("domain", "fixture"),
    d = new Delivery(s, new MemoryFiles());
  await d.connect(f.client);
  f.set({ postDelay: 40, postError: "INTERNAL_ERROR" });
  d.edit("Main", "A");
  const sending = d.submit("A", "A");
  await sleep(10);
  d.edit("Main", "B");
  await sending;
  await d.reconcile();
  assert.equal(s.drafts.Main.raw, "B");
  d.edit("Main", "");
  await d.reconcile();
  assert.equal(s.drafts.Main.raw, "A");
  assert.equal(s.drafts.Main.binding, s.pending?.id);
  assert.equal(f.posts.length, 1);
  d.edit("Main", "");
  await d.reconcile(true);
  assert.equal(s.drafts.Main.raw, "");
  await d.close();
});

test("Up at the first visual input row enters reading; arrows return at bottom and Escape preserves cursor/draft", async () => {
  const { Text } = await import("@earendil-works/pi-tui");
  const s = freshState("domain", "fixture"),
    d = new Delivery(s, new MemoryFiles());
  const terminal = new VirtualTerminal(40, 18),
    app = new TerminalApp("unused", terminal);
  app.delivery = d;
  app.editors.Main.enabled = true;
  app.tui.start();
  app.draw();
  app.documents.Main.entries = [
    {
      id: "history",
      version: "1",
      component: new Text("history row\n".repeat(100), 0, 0),
    },
  ];
  let submits = 0;
  d.onEvent = (e) => {
    if (e.type === "submit") submits++;
  };
  try {
    d.edit("Main", "first\nsecond");
    app.draw();
    await sleep(30);
    await terminal.flush();
    app.scrolls.Main.scrollToEnd();
    terminal.sendInput("\x1b[A");
    assert.equal(app.viewing, false);
    assert.equal(app.editors.Main.getCursor().line, 0);
    const cursor = app.editors.Main.getCursor(),
      raw = app.editors.Main.getExpandedText();
    terminal.sendInput("\x1b[A");
    assert.equal(app.viewing, true);
    const top = app.scrolls.Main.scrollTop;
    terminal.sendInput("\x1b[A");
    assert.equal(app.scrolls.Main.scrollTop, top - 1);
    terminal.sendInput("\x1b[B");
    terminal.sendInput("\x1b[B");
    assert.equal(app.viewing, false);
    assert.deepEqual(app.editors.Main.getCursor(), cursor);
    assert.equal(app.editors.Main.getExpandedText(), raw);
    terminal.sendInput("\x1b[A");
    terminal.sendInput("\x1b");
    assert.equal(app.viewing, false);
    assert.deepEqual(app.editors.Main.getCursor(), cursor);
    d.edit("Main", "word ".repeat(70));
    app.draw();
    await sleep(30);
    await terminal.flush();
    terminal.sendInput("\x1b[A");
    assert.equal(
      app.viewing,
      false,
      "wrapped continuation rows stay inside the editor",
    );
    for (let i = 0; i < 100 && !app.viewing; i++) terminal.sendInput("\x1b[A");
    assert.equal(app.viewing, true);
    assert.equal(s.drafts.Main.raw, "word ".repeat(70));
  } finally {
    await app.close();
  }
});

test("viewing typing and bracketed paste return to preserved cursor; Enter gestures only return, never submit", async () => {
  const d = new Delivery(freshState("domain", "fixture"), new MemoryFiles());
  const terminal = new VirtualTerminal(100, 25),
    app = new TerminalApp("unused", terminal);
  app.delivery = d;
  app.editors.Main.enabled = true;
  app.tui.start();
  let submits = 0;
  app.editors.Main.onExplicitSubmit = () => submits++;
  try {
    d.edit("Main", "AB");
    app.draw();
    terminal.sendInput("\x1b[D");
    terminal.sendInput("\x1b[A");
    assert(app.viewing);
    terminal.sendInput("你好");
    assert.equal(app.viewing, false);
    assert.equal(app.editors.Main.getExpandedText(), "A你好B");
    terminal.sendInput("\x1b[A");
    assert(app.viewing);
    terminal.sendInput("\x1b[200~粘贴\n/T\x1b[201~");
    assert.equal(app.viewing, false);
    assert.equal(app.editors.Main.getExpandedText(), "A你好粘贴\n/TB");
    for (const enter of ["\r", "\x1b[13;2u"]) {
      d.edit("Main", "unchanged");
      app.draw();
      terminal.sendInput("\x1b[A");
      assert(app.viewing);
      terminal.sendInput(enter);
      assert.equal(app.viewing, false);
      assert.equal(app.editors.Main.getExpandedText(), "unchanged");
      assert.equal(submits, 0);
    }
  } finally {
    await app.close();
  }
});

test("Task arrow boundaries page through the actual app and retain the editor draft", async () => {
  const { RemoteViews } =
    await import("../../../src/pi_secretary/src/tui/remote.ts");
  const { until } = await import("../issue9/helpers.ts");
  const client = new CoreClient({
    api_version: "1",
    url: "http://127.0.0.1:1",
    token: "unused",
    pid: 1,
    instance_id: "i",
    data_domain_id: "d",
  });
  const routes: string[] = [];
  client.query = async <T>(route: string) => {
    routes.push(route);
    return {
      items: [],
      version: "1",
      next_cursor: route.includes("cursor=") ? null : "cursor-p2",
    } as T;
  };
  const remote = new RemoteViews(client);
  await remote.refresh(["tasks"]);
  const d = new Delivery(freshState("domain", "fixture"), new MemoryFiles());
  const terminal = new VirtualTerminal(100, 25),
    app = new TerminalApp("unused", terminal);
  app.delivery = d;
  app.remote = remote;
  app.editors.Main.enabled = app.editors.Task.enabled = true;
  app.tui.start();
  app.draw();
  app.editors.Main.onExplicitSubmit?.("/T", plainSnapshot("/T", "typed"));
  try {
    d.edit("Task", "task draft");
    app.draw();
    await sleep(30);
    await terminal.flush();
    terminal.sendInput("\x1b[A");
    assert(app.viewing);
    terminal.sendInput("\x1b[B");
    await until(() =>
      app.documents.Task.render(100).join("").includes("第 2 页"),
    );
    assert.equal(remote.taskCursor, "cursor-p2");
    terminal.sendInput("\x1b[A");
    await until(() =>
      app.documents.Task.render(100).join("").includes("第 1 页"),
    );
    assert.equal(remote.taskCursor, undefined);
    assert.equal(app.editors.Task.getExpandedText(), "task draft");
    assert(routes.some((r) => r.includes("cursor=cursor-p2")));
  } finally {
    await app.close();
  }
});
