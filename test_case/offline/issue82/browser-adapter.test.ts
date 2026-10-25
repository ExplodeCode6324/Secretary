import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { Editor, flatten } from "../../../src/pi_secretary/src/tui/editor.ts";
import { InputProtocol } from "../../../src/pi_secretary/src/tui/input.ts";
// Runs the actual browser adapter against an in-memory DOM/channel. isTrusted values
// are simulated test inputs: this is event-routing evidence, never OS/browser input evidence.
class Element {
  listeners = new Map<string, Array<(e: any) => void>>();
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  classList = { add() {}, remove() {} };
  textContent = "";
  value = "";
  hidden = false;
  disabled = false;
  readOnly = false;
  id = "";
  children: Element[] = [];
  offsetLeft = 0;
  offsetTop = 0;
  scrollTop = 0;
  scrollHeight = 100;
  clientHeight = 100;
  addEventListener(name: string, fn: (e: any) => void) {
    const list = this.listeners.get(name) ?? [];
    list.push(fn);
    this.listeners.set(name, list);
  }
  dispatch(name: string, value: Record<string, unknown> = {}) {
    const e = {
      isTrusted: true,
      code: "",
      key: "",
      repeat: false,
      ctrlKey: false,
      shiftKey: false,
      metaKey: false,
      altKey: false,
      isComposing: false,
      keyCode: 0,
      preventDefault() {},
      stopPropagation() {},
      ...value,
    };
    for (const fn of this.listeners.get(name) ?? []) fn(e);
  }
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
  }
  querySelectorAll() {
    return [];
  }
  getBoundingClientRect() {
    return { top: 0, bottom: 20, left: 0, width: 10 };
  }
  closest() {
    return undefined;
  }
  focus() {}
  scrollIntoView() {}
  scrollBy() {}
}
function harness(international: unknown = Intl) {
  const elements = new Map<string, Element>();
  const get = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id)!;
  };
  const editor = new Editor(),
    input = new InputProtocol(() => editor),
    actions: string[] = [],
    copied: string[] = [],
    frames: any[] = [];
  const buttons = [
    "submit",
    "commands",
    "literal",
    "copy",
    "cut",
    "resume",
  ].map((action) => {
    const e = new Element();
    e.dataset.action = action;
    return e;
  });
  const state = () => ({
    revision: editor.draft.revision,
    selection: editor.draft.selection,
    length: flatten(editor.draft.nodes).length,
    runs: [],
    rows: [],
    pending: [],
    previews: [],
    panel: "",
    domain: "fixture",
    mode: "NORMAL",
    saved: true,
    outbox: "ready",
    notice: "",
    largeConfirmation: input.needsConfirmation,
    usage: 0,
    quota: 1000,
  });
  let socket: FakeSocket;
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    onopen?: () => void;
    onmessage?: (e: { data: string }) => void;
    onclose?: () => void;
    constructor() {
      socket = this;
    }
    receive(value: unknown) {
      this.onmessage?.({ data: JSON.stringify(value) });
    }
    send(text: string) {
      const frame = JSON.parse(text);
      frames.push(frame);
      queueMicrotask(() => {
        if (frame.type === "hello")
          this.receive({
            type: "hello",
            reconnect: "r".repeat(43),
            generation: 1,
          });
        else if (frame.type === "hello-ack")
          this.receive({ type: "sync", generation: 1, state: state() });
        else if (frame.type === "sync-ack")
          this.receive({ type: "ready", generation: 1, state: state() });
        else if (frame.type === "event") {
          try {
            const result = input.apply(frame.event);
            if (result.action) actions.push(result.action);
            this.receive({
              type: "ack",
              generation: 1,
              seq: frame.seq,
              state: state(),
            });
          } catch (error) {
            this.receive({
              type: "rejected",
              generation: 1,
              seq: frame.seq,
              error: (error as Error).message,
              state: state(),
            });
          }
        }
      });
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  const document = {
    getElementById: get,
    createElement: () => new Element(),
    createDocumentFragment: () => new Element(),
    querySelectorAll: () => buttons,
    body: new Element(),
    activeElement: get("sink"),
  };
  const context = {
    document,
    window: { getSelection: () => ({ toString: () => "" }) },
    navigator: {
      userAgent: "Chrome/155.0.0.0",
      clipboard: {
        writeText: async (text: string) => {
          copied.push(text);
        },
      },
    },
    history: { replaceState() {} },
    location: { hash: "#" + "b".repeat(43), origin: "http://127.0.0.1:12345" },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    WebSocket: FakeSocket,
    Intl: international,
    TextEncoder,
    crypto: { randomUUID },
    queueMicrotask,
    setTimeout,
    clearTimeout,
    innerWidth: 1000,
    innerHeight: 800,
    addEventListener() {},
  };
  vm.runInNewContext(
    fs.readFileSync("src/pi_secretary/src/tui/web/client.js", "utf8"),
    context,
  );
  socket!.onopen?.();
  return {
    elements,
    state,
    editor,
    actions,
    copied,
    frames,
    sink: get("sink"),
    buttons,
    socket: () => socket!,
    settle: () => new Promise<void>((resolve) => setImmediate(resolve)),
  };
}
test("actual adapter matches physical code plus every modifier, repeat and composition precedence", async () => {
  const h = harness();
  await h.settle();
  h.sink.dispatch("keydown", {
    code: "KeyS",
    key: "S",
    ctrlKey: true,
    shiftKey: true,
  });
  h.sink.dispatch("keydown", {
    code: "KeyS",
    key: "s",
    ctrlKey: true,
    repeat: true,
  });
  h.sink.dispatch("keydown", {
    code: "KeyS",
    key: "s",
    ctrlKey: true,
    metaKey: true,
  });
  h.sink.dispatch("keydown", {
    code: "KeyS",
    key: "s",
    ctrlKey: true,
    altKey: true,
  });
  h.sink.dispatch("keydown", {
    code: "KeyS",
    key: "s",
    ctrlKey: true,
    isTrusted: false,
  });
  await h.settle();
  assert.equal(h.actions.length, 0);
  h.sink.dispatch("keydown", { code: "KeyS", key: "S", ctrlKey: true });
  h.sink.dispatch("keydown", { code: "KeyS", key: "中", ctrlKey: true });
  await h.settle();
  assert.deepEqual(h.actions, ["submit", "submit"]);
  h.sink.dispatch("compositionstart");
  for (const code of ["KeyS", "KeyG", "KeyP", "KeyO", "Enter", "Space", "Tab"])
    h.sink.dispatch("keydown", {
      code,
      ctrlKey: code.startsWith("Key"),
      isComposing: true,
      keyCode: 229,
    });
  h.sink.dispatch("beforeinput", {
    inputType: "insertCompositionText",
    isComposing: true,
    data: "中",
  });
  assert.equal(flatten(h.editor.draft.nodes), "");
  h.sink.dispatch("compositionend", { data: "中文" });
  h.sink.dispatch("beforeinput", {
    inputType: "insertFromComposition",
    data: "中文",
  });
  await h.settle();
  assert.equal(flatten(h.editor.draft.nodes), "中文");
  assert.equal(h.actions.length, 2);
});

test("large paste confirmation pauses later typing and resumes it after Apply or Cancel", async () => {
  for (const accept of [true, false]) {
    const h = harness();
    await h.settle();
    const text = "p".repeat(600 * 1024);
    h.sink.dispatch("paste", {
      clipboardData: { files: [], getData: () => text },
    });
    h.sink.dispatch("beforeinput", { inputType: "insertText", data: "a" });
    await h.settle();
    assert.equal(flatten(h.editor.draft.nodes), "");
    assert.equal(h.elements.get("large-yes")!.hidden, false);
    assert.match(h.elements.get("pending")!.textContent, /a/);
    assert.equal(h.sink.readOnly, true);
    const beforeModalInput = h.frames.length;
    h.sink.dispatch("beforeinput", {
      inputType: "insertText",
      data: "not accepted",
    });
    h.sink.dispatch("keydown", { code: "ArrowLeft", key: "ArrowLeft" });
    h.sink.dispatch("keydown", { code: "KeyS", ctrlKey: true });
    h.sink.dispatch("compositionstart");
    h.sink.dispatch("beforeinput", {
      inputType: "insertCompositionText",
      data: "未接受",
      isComposing: true,
    });
    h.sink.dispatch("compositionend", { data: "未接受" });
    await h.settle();
    assert.equal(h.frames.length, beforeModalInput);
    assert.match(h.elements.get("status")!.textContent, /Apply or Cancel/);
    h.socket().receive({ type: "state", generation: 1, state: h.state() });
    h.elements.get(accept ? "large-yes" : "large-no")!.dispatch("click");
    h.elements.get(accept ? "large-yes" : "large-no")!.dispatch("click");
    await h.settle();
    assert.equal(flatten(h.editor.draft.nodes), (accept ? text : "") + "a");
    assert.equal(h.elements.get("large-yes")!.hidden, true);
    assert.equal(h.elements.get("pending-copy")!.hidden, true);
    assert.equal(h.sink.readOnly, false);
    assert.equal(
      h.frames.filter((frame) => frame.event?.type === "confirm-large").length,
      1,
    );
    h.sink.dispatch("beforeinput", { inputType: "insertText", data: "z" });
    await h.settle();
    assert.equal(flatten(h.editor.draft.nodes), (accept ? text : "") + "az");
  }
});

test("refusal and locked-state reasons survive unrelated state publication", async () => {
  const h = harness();
  await h.settle();
  h.editor.insert("x".repeat(4 * 1024 * 1024), "paste", true);
  h.socket().receive({ type: "state", generation: 1, state: h.state() });
  h.sink.dispatch("beforeinput", { inputType: "insertText", data: "overflow" });
  await h.settle();
  assert.match(h.elements.get("status")!.textContent, /DRAFT_TOO_LARGE/);
  for (let i = 0; i < 5; i++) {
    h.socket().receive({
      type: "state",
      generation: 1,
      state: { ...h.state(), notice: "Copied exact text.", saved: !!(i % 2) },
    });
    assert.match(h.elements.get("status")!.textContent, /DRAFT_TOO_LARGE/);
  }
  h.sink.dispatch("beforeinput", { inputType: "insertText", data: "" });
  await h.settle();
  h.sink.dispatch("compositionstart");
  h.sink.dispatch("compositionend", { data: "" });
  await h.settle();
  assert.match(h.elements.get("status")!.textContent, /DRAFT_TOO_LARGE/);
  h.editor.edit(0, 4 * 1024 * 1024 - 1, "", "typed", true);
  h.socket().receive({ type: "state", generation: 1, state: h.state() });
  assert.match(h.elements.get("status")!.textContent, /DRAFT_TOO_LARGE/);
  h.sink.dispatch("beforeinput", { inputType: "insertText", data: "z" });
  await h.settle();
  assert.doesNotMatch(h.elements.get("status")!.textContent, /DRAFT_TOO_LARGE/);
  h.socket().receive({ type: "replaced", reason: "duplicate" });
  h.socket().receive({ type: "state", generation: 1, state: h.state() });
  assert.match(h.elements.get("status")!.textContent, /duplicate/);
});

test("confirmation arriving during composition keeps the preview copyable without applying it", async () => {
  const h = harness();
  await h.settle();
  h.sink.dispatch("compositionstart");
  h.sink.value = "未提交预览";
  h.socket().receive({
    type: "state",
    generation: 1,
    state: { ...h.state(), largeConfirmation: true },
  });
  assert.match(h.elements.get("status")!.textContent, /composition preview/);
  assert.equal(h.elements.get("pending-copy")!.hidden, false);
  assert.equal(h.elements.get("large-yes")!.hidden, true);
  h.elements.get("pending-copy")!.dispatch("click");
  await h.settle();
  assert.match(h.copied[0], /未提交预览/);
  h.sink.dispatch("compositionend", { data: "未提交预览" });
  await h.settle();
  assert.match(h.elements.get("pending")!.textContent, /未提交预览/);
  assert.equal(flatten(h.editor.draft.nodes), "");
  assert.equal(h.frames.filter((frame) => frame.type === "event").length, 0);
});
test("actual adapter preserves control-bearing paste and drop; synthetic paste cannot mutate", async () => {
  const h = harness();
  await h.settle();
  const text = "/quit\r\n\u001b[201~\u0013\u009b\0中文👩‍💻";
  h.sink.dispatch("paste", {
    isTrusted: false,
    clipboardData: { files: [], getData: () => "bad" },
  });
  h.sink.dispatch("paste", {
    clipboardData: { files: [], getData: () => text },
  });
  await h.settle();
  h.sink.dispatch("drop", {
    dataTransfer: { files: [], getData: () => "\t/quit" },
  });
  await h.settle();
  assert.equal(
    flatten(h.editor.draft.nodes),
    text.replace(/\r\n?/g, "\n") + "\t/quit",
  );
  assert.ok(h.editor.draft.nodes.every((node) => node.kind === "paste"));
  assert.equal(h.actions.length, 0);
});
test("actual adapter prevents unsupported range mutation and retains a disconnected composition", async () => {
  const h = harness();
  await h.settle();
  h.sink.dispatch("beforeinput", { inputType: "insertText", data: "before" });
  await h.settle();
  h.sink.dispatch("beforeinput", {
    inputType: "insertReplacementText",
    data: "unsafe range",
  });
  await h.settle();
  assert.equal(flatten(h.editor.draft.nodes), "before");
  assert.match(
    h.elements.get("status")!.textContent,
    /Unsupported replacement/,
  );
  const c = harness();
  await c.settle();
  c.sink.dispatch("compositionstart");
  c.socket().receive({ type: "replaced", reason: "duplicate" });
  c.sink.dispatch("compositionend", { data: "未保存" });
  await c.settle();
  assert.match(c.elements.get("pending")!.textContent, /未保存/);
  assert.equal(c.elements.get("pending-copy")!.hidden, false);
  assert.equal(flatten(c.editor.draft.nodes), "");
});

test("missing Segmenter keeps an unsupported browser readable and prevents edits", async () => {
  const h = harness({});
  await h.settle();
  h.socket().receive({
    type: "ready",
    generation: 1,
    state: {
      ...h.state(),
      runs: [
        {
          id: "readonly",
          kind: "typed",
          expanded: true,
          text: "Read only draft",
          start: 0,
          end: 15,
        },
      ],
    },
  });
  assert.match(
    h.elements.get("status")!.textContent,
    /Unsupported browser: read-only/,
  );
  assert.ok(h.buttons.every((button) => button.disabled));
  assert.equal(
    h.elements
      .get("runs")!
      .children[0].children.map((node) => node.textContent)
      .join(""),
    "Read only draft",
  );
  h.sink.dispatch("beforeinput", { inputType: "insertText", data: "blocked" });
  await h.settle();
  assert.equal(h.frames.filter((frame) => frame.type === "event").length, 0);
});

test("empty native paste/drop sends no transaction and leaves a selected draft unchanged", async () => {
  const h = harness();
  await h.settle();
  h.editor.insert("keep", "typed");
  h.editor.select({ anchor: 0, head: 4 });
  h.socket().receive({ type: "ready", generation: 1, state: h.state() });
  const before = h.editor.snapshot(),
    count = h.frames.length;
  h.sink.dispatch("paste", { clipboardData: { files: [], getData: () => "" } });
  h.sink.dispatch("drop", { dataTransfer: { files: [], getData: () => "" } });
  await h.settle();
  assert.equal(h.frames.length, count);
  assert.deepEqual(h.editor.snapshot(), before);
});
