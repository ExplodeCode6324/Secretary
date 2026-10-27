import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import {
  Editor,
  GraphemeIndex,
  boundaries,
  flatten,
  validateDraft,
  DRAFT_BYTES,
} from "../../../src/pi_secretary/src/tui/editor.ts";
import { InputProtocol } from "../../../src/pi_secretary/src/tui/input.ts";
import { ClientStore } from "../../../src/pi_secretary/src/tui/state.ts";
import { StateWriter } from "../../../src/pi_secretary/src/tui/writer.ts";
import { TuiApp } from "../../../src/pi_secretary/src/tui/app.ts";
import { parseSubmission } from "../../../src/pi_secretary/src/tui/commands.ts";
const evidence = path.resolve(".demo-data/issue82-tui/implementation");
const directory = () => fs.mkdtempSync(path.join(evidence, "r1-regression-"));
async function shutdown(store: ClientStore) {
  const exited = once(store.writer.child, "exit");
  await store.close();
  await exited;
}
async function product() {
  const dir = directory();
  const app = new TuiApp(
    {
      data: dir,
      mode: "fixture",
      color: "none",
      quota: 256 * 1024 * 1024,
      maxOutbox: 1000,
      aliases: {},
    },
    {},
  );
  await app.store.open();
  return app;
}
test("full-context indexed boundaries match ICU across unbounded RI and combining/ZWJ contexts", () => {
  for (const text of [
    "e" + "\u0301".repeat(10000),
    "🇦".repeat(1001),
    "👩" + "\u200d👩".repeat(1001),
    "각✈️",
  ]) {
    const index = new GraphemeIndex(text),
      expected = boundaries(text);
    for (let offset = 0; offset <= text.length; offset++) {
      assert.equal(index.has(offset), expected.includes(offset));
      assert.equal(
        index.snap(offset, true),
        expected.find((n) => n >= offset),
      );
      assert.equal(
        index.snap(offset, false),
        expected.findLast((n) => n <= offset),
      );
    }
  }
});
test("durable reopen repairs only valid-range legacy caret metadata and retains UNKNOWN outbox bytes", async () => {
  const dir = directory(),
    root = path.join(dir, "tui-v1"),
    binding = {
      api_version: "1",
      data_domain_id: "unicode-recovery",
      mode: "fixture",
    } as const;
  let store = new ClientStore(new StateWriter(root));
  await store.open();
  await store.bind(binding);
  const entry = await store.enqueue(
    "Main",
    "pending original body",
    binding,
    store.editors.Main.draft.revision,
  );
  await store.update(entry.request_id, (item) => {
    item.state = "UNKNOWN";
    item.attempted = true;
    item.uncertain = true;
  });
  const original = await store.writer.read(entry.body);
  try {
    for (const [prefix, suffix] of [
      ["e", "\u0301abc"],
      ["👩", "\u200d💻"],
      ["✈", "\ufe0f"],
      ["🇨", "🇦🇧"],
      ["ᄀ", "ᅡ"],
    ]) {
      const e = (store.editors.Main = new Editor());
      e.insert(suffix, "paste");
      e.select({ anchor: 0, head: 0 });
      e.insert(prefix, "typed");
      validateDraft(e.draft);
      e.undo();
      e.undo(true);
      validateDraft(e.draft);
      assert.equal(flatten(e.draft.nodes), prefix + suffix);
      // Reproduce metadata emitted by the first product commit, without weakening blob authentication.
      e.draft.selection = { anchor: prefix.length, head: prefix.length };
      await store.save();
      await shutdown(store);
      store = new ClientStore(new StateWriter(root));
      await store.open();
      validateDraft(store.editors.Main.draft);
      assert.equal(flatten(store.editors.Main.draft.nodes), prefix + suffix);
      assert.equal(store.state.outbox[0].state, "UNKNOWN");
      assert.equal(
        await store.writer.read(store.state.outbox[0].body),
        original,
      );
      const broken = store.editors.Main.snapshot();
      broken.draft.selection.head = -1;
      assert.throws(() => Editor.restore(broken), /INVALID_SELECTION/);
      broken.draft.selection.head = 1e9;
      assert.throws(() => Editor.restore(broken), /INVALID_SELECTION/);
    }
  } finally {
    await shutdown(store);
  }
});
test("completion cannot promote paste-origin tokens, including mixed ranges and cycles", async () => {
  const app = await product();
  try {
    const e = app.store.editors.Main;
    e.insert("/qu", "paste");
    const before = e.snapshot();
    (app as any).complete();
    assert.deepEqual(e.snapshot(), before);
    assert.equal(parseSubmission(e.draft, "Main").kind, "message");
    assert.match((app as any).notice, /only to typed/);
    app.store.editors.Main = new Editor();
    const mixed = app.store.editors.Main;
    mixed.insert("/q", "typed");
    mixed.insert("u", "paste");
    const mixedBefore = mixed.snapshot();
    (app as any).complete();
    (app as any).complete();
    assert.deepEqual(mixed.snapshot(), mixedBefore);
    app.store.editors.Main = new Editor();
    const typed = app.store.editors.Main;
    typed.insert("/", "typed");
    (app as any).complete();
    const first = flatten(typed.draft.nodes);
    (app as any).complete();
    assert.notEqual(flatten(typed.draft.nodes), first);
    assert.ok(typed.draft.nodes.every((n) => n.kind === "typed"));
  } finally {
    await app.close();
  }
});
test("empty paste transaction preserves selection, history and body; cancelled transaction permits editing", () => {
  const e = new Editor();
  e.insert("keep", "typed");
  e.select({ anchor: 0, head: 4 });
  const input = new InputProtocol(() => e),
    before = e.snapshot(),
    revision = e.draft.revision;
  input.apply({ type: "begin", revision, id: "empty", source: "paste" });
  input.apply({ type: "commit", revision, id: "empty" });
  assert.deepEqual(e.snapshot(), before);
  input.apply({ type: "begin", revision, id: "cancelled", source: "paste" });
  input.apply({ type: "cancel", revision });
  input.apply({ type: "insert", revision, text: "edit" });
  assert.equal(flatten(e.draft.nodes), "edit");
});
test("accepted edits and caret moves expire large confirmation without invalidating subsequent input", () => {
  for (const change of ["insert", "move"] as const) {
    const editor = new Editor();
    editor.insert("hello", "typed");
    const input = new InputProtocol(() => editor);
    const revision = editor.draft.revision;
    input.apply({ type: "begin", revision, id: "large", source: "paste" });
    for (let index = 0; index < 10; index++)
      input.apply({
        type: "chunk",
        revision,
        id: "large",
        index,
        text: "p".repeat(60000),
      });
    assert.throws(
      () => input.apply({ type: "commit", revision, id: "large" }),
      /NON_UNDOABLE_CONFIRMATION_REQUIRED/,
    );
    input.apply(
      change === "insert"
        ? { type: "insert", revision, text: "a" }
        : {
            type: "move",
            revision,
            direction: "left",
            extend: false,
            word: false,
          },
    );
    assert.equal(input.needsConfirmation, false);
    const before = editor.snapshot();
    assert.throws(
      () => input.apply({ type: "confirm-large", revision, accept: true }),
      /LARGE_EDIT_EXPIRED/,
    );
    assert.deepEqual(editor.snapshot(), before);
    input.apply({ type: "insert", revision: editor.draft.revision, text: "z" });
    assert.equal(
      flatten(editor.draft.nodes),
      change === "insert" ? "helloaz" : "hellzo",
    );
  }
});
test(
  "non-empty draft accepts paste up to 4MiB through retained chunk acknowledgements within 5s; large keystrokes stay bounded",
  { timeout: 30000 },
  async () => {
    const app = await product();
    try {
      app.store.editors.Main.insert("a".repeat(400 * 1024), "typed", true);
      let snapshots = 0;
      const snapshot = app.snapshot.bind(app);
      app.snapshot = () => {
        snapshots++;
        return snapshot();
      };
      app.outbox.connect(1);
      const event = async (value: unknown) => {
        try {
          const result = await app.event(value, 1);
          return {
            type: "ack",
            state: result?.unchanged ? undefined : app.snapshot(),
            error: undefined,
          };
        } catch (error) {
          return {
            type: "rejected",
            error: (error as Error).message,
            state: app.snapshot(),
          };
        }
      };
      const revision = app.store.editors.Main.draft.revision,
        text = "b".repeat(DRAFT_BYTES - 400 * 1024),
        begin = performance.now();
      const beforeSnapshots = snapshots;
      assert.equal(
        (await event({ type: "begin", revision, id: "large", source: "paste" }))
          .state,
        undefined,
      );
      for (
        let offset = 0, index = 0;
        offset < text.length;
        offset += 8000, index++
      ) {
        const ack = await event({
          type: "chunk",
          revision,
          id: "large",
          index,
          text: text.slice(offset, offset + 8000),
        });
        assert.equal(ack.type, "ack");
        assert.equal(ack.state, undefined);
      }
      const committed = await event({ type: "commit", revision, id: "large" });
      assert.equal(committed.error, "NON_UNDOABLE_CONFIRMATION_REQUIRED");
      const transferMs = performance.now() - begin;
      assert.ok(transferMs < 5000, String(transferMs));
      assert.ok(
        snapshots - beforeSnapshots < 10,
        "chunks must not rebuild snapshots",
      );
      assert.equal(
        (await event({ type: "confirm-large", revision, accept: true })).type,
        "ack",
      );
      assert.equal(
        flatten(app.store.editors.Main.draft.nodes),
        "a".repeat(400 * 1024) + text,
      );
      const overflow = await event({
        type: "insert",
        revision: app.store.editors.Main.draft.revision,
        text: "x",
      });
      assert.equal(overflow.error, "DRAFT_TOO_LARGE");
      assert.equal(app.store.editors.Main.index.text.length, DRAFT_BYTES);
      const metrics = [];
      for (const size of [1024 * 1024, DRAFT_BYTES - 32]) {
        app.store.editors.Main = new Editor();
        app.store.editors.Main.insert("x".repeat(size), "typed", true);
        const timings = [];
        for (let i = 0; i < 20; i++) {
          const start = performance.now();
          app.store.editors.Main.insert("y", "typed");
          app.snapshot();
          timings.push(performance.now() - start);
        }
        timings.sort((a, b) => a - b);
        const result = { size, p95: timings[18], max: timings[19] };
        metrics.push(result);
        assert.ok(
          result.p95 <= 100 && result.max <= 250,
          JSON.stringify(result),
        );
      }
      console.log(
        JSON.stringify({ issue82LargeDraft: { transferMs, metrics } }),
      );
    } finally {
      await app.close();
    }
  },
);

test(
  "expired and repeated large-edit decisions are recoverable over the local presentation event port",
  { timeout: 20000 },
  async () => {
    const app = await product();
    try {
      app.outbox.connect(1);
      const event = async (value: unknown) => {
        try {
          const result = await app.event(value, 1);
          return {
            type: "ack",
            state: result?.unchanged ? undefined : app.snapshot(),
            error: undefined,
          };
        } catch (error) {
          return {
            type: "rejected",
            error: (error as Error).message,
            state: app.snapshot(),
          };
        }
      };
      for (const change of ["insert", "select", "cancel", "apply"]) {
        const editor = (app.store.editors.Main = new Editor());
        editor.insert("hello", "typed");
        const revision = editor.draft.revision;
        assert.equal(
          (
            await event({
              type: "begin",
              revision,
              id: change,
              source: "paste",
            })
          ).type,
          "ack",
        );
        for (let index = 0; index < 10; index++)
          assert.equal(
            (
              await event({
                type: "chunk",
                revision,
                id: change,
                index,
                text: "p".repeat(60000),
              })
            ).type,
            "ack",
          );
        assert.equal(
          (await event({ type: "commit", revision, id: change })).error,
          "NON_UNDOABLE_CONFIRMATION_REQUIRED",
        );
        let accepted;
        if (change === "insert")
          accepted = await event({ type: "insert", revision, text: "a" });
        else if (change === "select")
          accepted = await event({
            type: "select",
            revision,
            anchor: 0,
            head: 0,
          });
        else
          accepted = await event({
            type: "confirm-large",
            revision,
            accept: change === "apply",
          });
        assert.equal(accepted.type, "ack");
        assert.equal(accepted.state!.largeConfirmation, false);
        const before = editor.snapshot();
        for (const accept of [true, false]) {
          const stale = await event({
            type: "confirm-large",
            revision,
            accept,
          });
          assert.equal(stale.type, "rejected");
          assert.match(stale.error!, /^LARGE_EDIT_EXPIRED/);
          assert.deepEqual(editor.snapshot(), before);
        }
        assert.equal(
          (
            await event({
              type: "insert",
              revision: editor.draft.revision,
              text: "z",
            })
          ).type,
          "ack",
        );
        assert.equal(
          flatten(editor.draft.nodes),
          change === "insert"
            ? "helloaz"
            : change === "select"
              ? "zhello"
              : change === "apply"
                ? "hello" + "p".repeat(600000) + "z"
                : "helloz",
        );
      }
    } finally {
      await app.close();
    }
  },
);

test("large atomic Backspace/Delete freeze a range without mutating selection, revision or undo before consent", () => {
  const text = "p".repeat(600 * 1024);
  for (const direction of ["backward", "forward"] as const) {
    for (const decision of ["apply", "cancel", "insert", "move"] as const) {
      const editor = new Editor();
      editor.insert("A", "typed");
      editor.insert(text, "paste", true);
      const pasted = editor.draft.nodes.find((node) => node.kind === "paste")!;
      editor.insert("B", "typed");
      editor.togglePaste(pasted.id, false);
      const head = direction === "backward" ? 1 + text.length : 1;
      editor.select({ anchor: head, head });
      const input = new InputProtocol(() => editor),
        before = editor.snapshot();
      assert.throws(
        () =>
          input.apply({
            type: "delete",
            revision: editor.draft.revision,
            direction,
          }),
        /NON_UNDOABLE_CONFIRMATION_REQUIRED/,
      );
      assert.deepEqual(editor.snapshot(), before);
      assert.equal(input.needsConfirmation, true);
      if (decision === "insert" || decision === "move") {
        input.apply(
          decision === "insert"
            ? { type: "insert", revision: editor.draft.revision, text: "z" }
            : {
                type: "move",
                revision: editor.draft.revision,
                direction: direction === "backward" ? "right" : "left",
                extend: false,
                word: false,
              },
        );
        assert.equal(input.needsConfirmation, false);
        const changed = editor.snapshot();
        assert.throws(
          () =>
            input.apply({
              type: "confirm-large",
              revision: editor.draft.revision,
              accept: true,
            }),
          /LARGE_EDIT_EXPIRED/,
        );
        assert.deepEqual(editor.snapshot(), changed);
      } else {
        input.apply({
          type: "confirm-large",
          revision: editor.draft.revision,
          accept: decision === "apply",
        });
        if (decision === "cancel") assert.deepEqual(editor.snapshot(), before);
        else {
          assert.equal(flatten(editor.draft.nodes), "AB");
          assert.deepEqual(editor.draft.selection, { anchor: 1, head: 1 });
          editor.undo();
          assert.equal(
            flatten(editor.draft.nodes),
            "AB",
            "confirmed removal is explicitly non-undoable",
          );
        }
        assert.equal(input.needsConfirmation, false);
        const after = editor.snapshot();
        assert.throws(
          () =>
            input.apply({
              type: "confirm-large",
              revision: editor.draft.revision,
              accept: true,
            }),
          /LARGE_EDIT_EXPIRED/,
        );
        assert.deepEqual(editor.snapshot(), after);
        input.apply({
          type: "insert",
          revision: editor.draft.revision,
          text: "z",
        });
        assert.equal(
          flatten(editor.draft.nodes),
          decision === "apply"
            ? "AzB"
            : direction === "backward"
              ? "A" + text + "zB"
              : "Az" + text + "B",
        );
      }
    }
    const empty = new Editor(),
      input = new InputProtocol(() => empty),
      before = empty.snapshot();
    assert.deepEqual(
      input.apply({
        type: "delete",
        revision: empty.draft.revision,
        direction,
      }),
      {},
    );
    assert.deepEqual(empty.snapshot(), before);
    assert.equal(input.needsConfirmation, false);
    for (const grapheme of ["e\u0301", "👩‍💻", "🇨🇳", "가"]) {
      const e = new Editor();
      e.insert(grapheme, "typed");
      e.select({
        anchor: direction === "forward" ? 0 : grapheme.length,
        head: direction === "forward" ? 0 : grapheme.length,
      });
      new InputProtocol(() => e).apply({
        type: "delete",
        revision: e.draft.revision,
        direction,
      });
      assert.equal(flatten(e.draft.nodes), "");
    }
  }
});

test("refused large deletion leaves durable draft, undo and UNKNOWN outbox unchanged", async () => {
  const app = await product();
  try {
    const binding = {
      api_version: "1",
      data_domain_id: "delete-confirmation",
      mode: "fixture",
    } as const;
    await app.store.bind(binding);
    const entry = await app.store.enqueue(
      "Main",
      "protected original bytes",
      binding,
      app.editor().draft.revision,
    );
    await app.store.update(entry.request_id, (value) => {
      value.state = "UNKNOWN";
      value.attempted = true;
      value.uncertain = true;
    });
    const editor = app.editor();
    editor.insert("p".repeat(600 * 1024), "paste", true);
    editor.togglePaste(editor.draft.nodes[0].id, false);
    await app.store.save();
    app.outbox.connect(1);
    const originalBody = await app.store.writer.read(entry.body);
    const before = editor.snapshot(),
      state = structuredClone(app.store.state),
      sequence = app.store.writer.sequence;
    await assert.rejects(
      app.event(
        {
          type: "delete",
          revision: editor.draft.revision,
          direction: "backward",
        },
        1,
      ),
      /NON_UNDOABLE_CONFIRMATION_REQUIRED/,
    );
    assert.deepEqual(editor.snapshot(), before);
    assert.deepEqual(app.store.state, state);
    assert.equal(
      app.store.writer.sequence,
      sequence,
      "refusal must not write a new durable state",
    );
    assert.equal(await app.store.writer.read(entry.body), originalBody);
    await app.event(
      { type: "confirm-large", revision: editor.draft.revision, accept: false },
      1,
    );
    assert.deepEqual(editor.snapshot(), before);
    assert.deepEqual(app.store.state.outbox, state.outbox);
  } finally {
    await app.close();
  }
});

test("capacity refusal precedes large-edit confirmation and preserves the full editor snapshot", () => {
  const editor = new Editor();
  editor.insert("x".repeat(DRAFT_BYTES - 100), "paste", true);
  const input = new InputProtocol(() => editor),
    before = editor.snapshot();
  assert.throws(
    () => editor.insert("中".repeat(200000), "paste"),
    /DRAFT_TOO_LARGE/,
  );
  assert.deepEqual(editor.snapshot(), before);
  assert.equal(input.needsConfirmation, false);
});

test("capacity preflight accepts fitting canonical replacements and exact UTF-8 limits", () => {
  const editor = new Editor();
  editor.insert("x".repeat(DRAFT_BYTES - 1), "paste", true);
  editor.insert("\r\n", "typed");
  assert.equal(Buffer.byteLength(flatten(editor.draft.nodes)), DRAFT_BYTES);
  const before = editor.snapshot();
  const replacement = "中".repeat(Math.floor(DRAFT_BYTES / 3)) + "a";
  assert.throws(
    () =>
      editor.edit(0, flatten(editor.draft.nodes).length, replacement, "paste"),
    /NON_UNDOABLE_CONFIRMATION_REQUIRED/,
  );
  assert.deepEqual(editor.snapshot(), before);
  editor.edit(
    0,
    flatten(editor.draft.nodes).length,
    replacement,
    "paste",
    true,
  );
  assert.equal(Buffer.byteLength(flatten(editor.draft.nodes)), DRAFT_BYTES);
  editor.select({ anchor: 0, head: 0 });
  const full = editor.snapshot();
  assert.throws(() => editor.insert("é", "typed"), /DRAFT_TOO_LARGE/);
  assert.deepEqual(editor.snapshot(), full);
});

test("over-capacity paste creates no confirmation or durable change to UNKNOWN outbox", async () => {
  const app = await product();
  try {
    const binding = {
      api_version: "1",
      data_domain_id: "capacity-regression",
      mode: "fixture",
    } as const;
    await app.store.bind(binding);
    const entry = await app.store.enqueue(
      "Main",
      "original unknown body",
      binding,
      app.editor().draft.revision,
    );
    await app.store.update(entry.request_id, (item) => {
      item.state = "UNKNOWN";
      item.attempted = true;
      item.uncertain = true;
    });
    const editor = app.editor();
    editor.insert("x".repeat(DRAFT_BYTES - 100), "paste", true);
    await app.store.save();
    app.outbox.connect(1);
    const before = editor.snapshot(),
      state = structuredClone(app.store.state),
      sequence = app.store.writer.sequence,
      body = await app.store.writer.read(entry.body),
      revision = editor.draft.revision;
    await app.event(
      { type: "begin", revision, id: "capacity", source: "paste" },
      1,
    );
    for (let i = 0; i < 10; i++)
      await app.event(
        {
          type: "chunk",
          revision,
          id: "capacity",
          index: i,
          text: "中".repeat(20000),
        },
        1,
      );
    await assert.rejects(
      app.event({ type: "commit", revision, id: "capacity" }, 1),
      /DRAFT_TOO_LARGE/,
    );
    assert.deepEqual(editor.snapshot(), before);
    assert.deepEqual(app.store.state, state);
    assert.equal(app.store.writer.sequence, sequence);
    assert.equal((app as any).input.needsConfirmation, false);
    assert.equal(await app.store.writer.read(entry.body), body);
  } finally {
    await app.close();
  }
});
