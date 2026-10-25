import assert from "node:assert/strict";
import test from "node:test";
import {
  Editor,
  flatten,
  displayText,
  DRAFT_BYTES,
  UNDO_BYTES,
} from "../../../src/pi_secretary/src/tui/editor.ts";
import {
  parseSubmission,
  aliasesOf,
  resolveID,
  completions,
} from "../../../src/pi_secretary/src/tui/commands.ts";

test("paste provenance survives embedded terminal controls, canonicalization, edit, undo and reload", () => {
  const editor = new Editor();
  const text = "/quit\t中文😀\r\n\x1b[201~\x13\x07\x03\u009b\0";
  editor.insert(text, "paste");
  assert.equal(parseSubmission(editor.draft, "Main").kind, "message");
  assert.equal(flatten(editor.draft.nodes), text.replace(/\r\n/g, "\n"));
  const id = editor.draft.nodes[0].id;
  assert.throws(() => editor.edit(1, 2, "a", "typed"), /EXPAND_PASTE_FIRST/);
  editor.togglePaste(id, true);
  editor.edit(1, 2, "Q", "typed");
  assert.ok(editor.draft.nodes.every((n) => n.kind === "paste"));
  editor.undo();
  assert.equal(flatten(editor.draft.nodes), text.replace(/\r\n/g, "\n"));
  const recovered = new Editor(JSON.parse(JSON.stringify(editor.draft)));
  assert.equal(parseSubmission(recovered.draft, "Main").kind, "message");
  assert.match(displayText(flatten(recovered.draft.nodes)), /⟨001b⟩/);
  assert.ok(flatten(recovered.draft.nodes).includes("\x1b"));
});

test("ordered nodes, immutable pasted labels, grapheme boundaries and cut races", () => {
  const editor = new Editor();
  editor.insert("[pasted 20 lines] ", "typed");
  editor.insert("a\nb", "paste");
  editor.insert("👩‍💻e\u0301", "typed");
  const value = flatten(editor.draft.nodes);
  assert.equal(value, "[pasted 20 lines] a\nb👩‍💻e\u0301");
  assert.throws(
    () => editor.select({ anchor: value.length - 1, head: value.length }),
    /INVALID_RANGE/,
  );
  editor.select({ anchor: 0, head: 1 });
  const revision = editor.draft.revision,
    selection = { ...editor.draft.selection };
  editor.insert("X", "typed");
  assert.throws(
    () => editor.cutAfterCopy(revision, selection, true),
    /STALE_CUT/,
  );
  assert.equal(flatten(editor.draft.nodes)[0], "X");
  editor.select({ anchor: 0, head: 1 });
  assert.throws(
    () =>
      editor.cutAfterCopy(editor.draft.revision, editor.draft.selection, false),
    /CLIPBOARD_FAILED/,
  );
  editor.cutAfterCopy(
    editor.draft.revision,
    { ...editor.draft.selection },
    true,
  );
  assert.equal(flatten(editor.draft.nodes)[0], "p");
  editor.undo();
  assert.equal(flatten(editor.draft.nodes)[0], "X");
});

test("capacity rejection never replaces draft; large non-undoable edit needs explicit consent", () => {
  const editor = new Editor();
  editor.insert("kept", "typed");
  assert.throws(
    () => editor.insert("x".repeat(UNDO_BYTES + 1), "paste"),
    /NON_UNDOABLE/,
  );
  assert.equal(flatten(editor.draft.nodes), "kept");
  assert.throws(
    () => editor.insert("x".repeat(DRAFT_BYTES), "paste", true),
    /DRAFT_TOO_LARGE/,
  );
  assert.equal(flatten(editor.draft.nodes), "kept");
  assert.throws(() => editor.insert("\ud800", "typed"), /INVALID_TEXT/);
});

test("strict command grammar and literal send payload do not reinterpret paste or shell text", () => {
  function parse(text: string, kind: "typed" | "paste" = "typed") {
    const editor = new Editor();
    editor.insert(text, kind);
    return parseSubmission(editor.draft, "Main");
  }
  assert.deepEqual(parse('/send  /quit; "x"\nend'), {
    kind: "command",
    name: "send",
    args: [],
    payload: ' /quit; "x"\nend',
  });
  for (const value of [
    "/sendx",
    "/send\nx",
    "/quit; echo x",
    "/quit x",
    "/M\n/T",
    '/select "open',
    "/history sideways",
    "/cancel",
  ])
    assert.throws(() => parse(value));
  assert.deepEqual(parse("/quit", "paste"), { kind: "message", text: "/quit" });
  const editor = new Editor();
  editor.insert("/", "typed");
  editor.insert("quit", "paste");
  assert.throws(
    () => parseSubmission(editor.draft, "Main"),
    /PASTED_COMMAND_TOKEN/,
  );
  assert.throws(() => aliasesOf({ quit: "M" }), /INVALID_ALIAS/);
  assert.throws(() => resolveID("a", ["abc", "abd"]), /AMBIGUOUS_ID/);
  assert.equal(resolveID("abc", ["abc", "abcd"]), "abc");
  assert.ok(completions("/q", "Main").includes("/quit"));
});
