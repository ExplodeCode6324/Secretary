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
  constructor(
    private focusState?: { activeElement: Element | null; body?: Element },
  ) {}
  listeners = new Map<string, Array<(e: any) => void>>();
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  classList = { add() {}, remove() {} };
  textContent = "";
  value = "";
  private concealed = false;
  get hidden() {
    return this.concealed;
  }
  set hidden(value: boolean) {
    this.concealed = value;
    if (value && this.focusState?.activeElement === this)
      this.focusState.activeElement = this.focusState.body ?? null;
  }
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
    if (name === "click" && !this.disabled && !this.hidden) this.focus();
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
  focus() {
    if (this.focusState) this.focusState.activeElement = this;
  }
  scrollIntoView() {}
  scrollBy() {}
}
function harness(international: unknown = Intl) {
  const focusState: { activeElement: Element | null; body?: Element } = {
    activeElement: null,
  };
  const elements = new Map<string, Element>();
  const extra: Record<string, unknown> = {};
  const get = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element(focusState));
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
    const e = new Element(focusState);
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
    ...extra,
  });
  let socket: FakeSocket,
    connectionGeneration = 0;
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    onopen?: () => void;
    onmessage?: (e: { data: string }) => void;
    onclose?: () => void;
    readonly generation = ++connectionGeneration;
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
            generation: this.generation,
          });
        else if (frame.type === "hello-ack")
          this.receive({
            type: "sync",
            generation: this.generation,
            state: state(),
          });
        else if (frame.type === "sync-ack")
          this.receive({
            type: "ready",
            generation: this.generation,
            state: state(),
          });
        else if (frame.type === "event") {
          try {
            const result = input.apply(frame.event);
            if (result.action) actions.push(result.action);
            this.receive({
              type: "ack",
              generation: this.generation,
              seq: frame.seq,
              state: state(),
            });
          } catch (error) {
            this.receive({
              type: "rejected",
              generation: this.generation,
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
    createElement: () => new Element(focusState),
    createDocumentFragment: () => new Element(focusState),
    querySelectorAll: () => buttons,
    body: new Element(focusState),
    get activeElement() {
      return focusState.activeElement;
    },
  };
  focusState.body = document.body;
  focusState.activeElement = document.body;
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
    document,
    extra,
    input,
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
      h.document.activeElement,
      h.sink,
      "decision ACK restores keyboard focus",
    );
    assert.equal(
      h.frames.filter((frame) => frame.event?.type === "confirm-large").length,
      1,
    );
    h.document.activeElement!.dispatch("beforeinput", {
      inputType: "insertText",
      data: "z",
    });
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
  assert.match(h.elements.get("refusal")!.textContent, /DRAFT_TOO_LARGE/);
  for (let i = 0; i < 5; i++) {
    h.socket().receive({
      type: "state",
      generation: 1,
      state: { ...h.state(), notice: "Copied exact text.", saved: !!(i % 2) },
    });
    assert.match(h.elements.get("refusal")!.textContent, /DRAFT_TOO_LARGE/);
  }
  h.sink.dispatch("beforeinput", { inputType: "insertText", data: "" });
  await h.settle();
  h.sink.dispatch("compositionstart");
  h.sink.dispatch("compositionend", { data: "" });
  await h.settle();
  assert.match(h.elements.get("refusal")!.textContent, /DRAFT_TOO_LARGE/);
  h.editor.edit(0, 4 * 1024 * 1024 - 1, "", "typed", true);
  h.socket().receive({ type: "state", generation: 1, state: h.state() });
  assert.match(h.elements.get("refusal")!.textContent, /DRAFT_TOO_LARGE/);
  h.sink.dispatch("beforeinput", { inputType: "insertText", data: "z" });
  await h.settle();
  assert.doesNotMatch(
    h.elements.get("refusal")!.textContent,
    /DRAFT_TOO_LARGE/,
  );
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

test("refusal remains visible alongside Resume and clears only on a completed fresh handshake", async () => {
  const h = harness();
  h.extra.outbox = "waiting for explicit Resume";
  await h.settle();
  h.sink.dispatch("keydown", { code: "KeyB", ctrlKey: true });
  assert.match(
    h.elements.get("status")!.textContent,
    /waiting for explicit Resume/,
  );
  assert.match(h.elements.get("refusal")!.textContent, /Unsupported control/);
  for (const pendingState of ["PREPARED", "UNKNOWN"]) {
    h.socket().receive({
      type: "state",
      generation: 1,
      state: { ...h.state(), pending: [{ state: pendingState }] },
    });
    assert.match(
      h.elements.get("status")!.textContent,
      /waiting for explicit Resume/,
    );
    assert.match(h.elements.get("refusal")!.textContent, /Unsupported control/);
  }
  h.sink.dispatch("beforeinput", { inputType: "insertText", data: "" });
  await h.settle();
  assert.match(h.elements.get("refusal")!.textContent, /Unsupported control/);
  h.sink.dispatch("beforeinput", {
    inputType: "insertReplacementText",
    data: "blocked",
  });
  assert.match(
    h.elements.get("status")!.textContent,
    /Unsupported replacement/,
  );
  h.elements.get("resync")!.dispatch("click");
  assert.match(h.elements.get("refusal")!.textContent, /Unsupported control/);
  h.socket().onopen?.();
  await h.settle();
  assert.equal(h.socket().generation, 2);
  assert.equal(h.elements.get("refusal")!.hidden, true);
  assert.equal(h.elements.get("refusal")!.textContent, "");
  assert.match(
    h.elements.get("status")!.textContent,
    /waiting for explicit Resume/,
  );
});

test("decision replies restore expired prompts but do not steal focus across recovery boundaries", async () => {
  for (const boundary of [
    "expired",
    "other-control",
    "disconnect",
    "takeover",
    "new-prompt",
    "composition",
  ] as const) {
    const h = harness();
    await h.settle();
    h.sink.dispatch("paste", {
      clipboardData: { files: [], getData: () => "p".repeat(600 * 1024) },
    });
    if (boundary === "other-control")
      h.sink.dispatch("beforeinput", {
        inputType: "insertText",
        data: "queued",
      });
    await h.settle();
    if (boundary === "expired") h.input.invalidateConfirmation();
    if (boundary === "new-prompt") {
      const receive = h.socket().receive.bind(h.socket());
      h.socket().receive = (value: any) =>
        receive(
          value.type === "ack" && value.state
            ? { ...value, state: { ...value.state, largeConfirmation: true } }
            : value,
        );
    }
    h.elements.get("large-yes")!.dispatch("click");
    if (boundary === "other-control") h.elements.get("pending-copy")!.focus();
    if (boundary === "disconnect") h.socket().close();
    if (boundary === "takeover")
      h.socket().receive({ type: "replaced", reason: "duplicate" });
    if (boundary === "composition") {
      h.socket().receive({
        type: "state",
        generation: 1,
        state: { ...h.state(), largeConfirmation: false },
      });
      h.sink.dispatch("compositionstart");
    }
    await h.settle();
    if (boundary === "expired") {
      assert.equal(h.document.activeElement, h.sink);
      assert.equal(h.sink.readOnly, false);
      assert.match(
        h.elements.get("refusal")!.textContent,
        /LARGE_EDIT_EXPIRED/,
      );
      h.document.activeElement!.dispatch("beforeinput", {
        inputType: "insertText",
        data: "z",
      });
      await h.settle();
      assert.equal(flatten(h.editor.draft.nodes), "z");
    } else {
      assert.notEqual(
        h.document.activeElement,
        h.sink,
        boundary + " must not force input focus",
      );
      if (boundary !== "other-control") assert.equal(h.sink.readOnly, true);
    }
  }
});

test("over-capacity large paste never opens consent or replays later queued intentions", async () => {
  const h = harness();
  await h.settle();
  h.editor.insert("p".repeat(4 * 1024 * 1024 - 100), "paste", true);
  h.socket().receive({ type: "state", generation: 1, state: h.state() });
  const before = h.editor.snapshot();
  h.sink.dispatch("paste", {
    clipboardData: { files: [], getData: () => "x".repeat(600 * 1024) },
  });
  h.sink.dispatch("beforeinput", { inputType: "insertText", data: "later" });
  await h.settle();
  assert.deepEqual(h.editor.snapshot(), before);
  assert.equal(h.input.needsConfirmation, false);
  assert.equal(h.elements.get("large-yes")!.hidden, true);
  assert.equal(
    h.frames.some((frame) => frame.event?.type === "confirm-large"),
    false,
  );
  assert.equal(
    h.frames.some((frame) => frame.event?.text === "later"),
    false,
  );
  assert.match(h.elements.get("pending")!.textContent, /later/);
  assert.match(
    h.elements.get("status")!.textContent,
    /retained for inspection.*DRAFT_TOO_LARGE/,
  );
  assert.match(h.elements.get("refusal")!.textContent, /DRAFT_TOO_LARGE/);
  assert.equal(h.sink.readOnly, true);
});
