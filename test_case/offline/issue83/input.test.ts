import test from "node:test";
import assert from "node:assert/strict";
import {
  parseInput,
  parseDraft,
  commandCompletion,
  DraftEditor,
} from "../../../src/pi_secretary/src/tui/input.ts";
import {
  plainSnapshot,
  originAt,
} from "../../../src/pi_secretary/src/tui/draft.ts";
import { TuiAltScreen } from "@earendil-works/pi-tui";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";

test("ID command grammar preserves ID case, restricts Task root and never sends Task text", () => {
  for (const name of ["search_task", "taskdetail"]) {
    assert.deepEqual(
      parseInput("/" + name.toUpperCase() + " AbC-123 \t", "Task"),
      { kind: name, id: "AbC-123" },
    );
    for (const text of [
      `/${name}`,
      `/${name}  abc`,
      `/${name}\tabc`,
      `/${name} abc def`,
      `/${name} abc\n`,
      `/${name} abc\n/T`,
      `/${name} abc_`,
    ])
      assert.equal(parseInput(text, "Task").kind, "error", text);
    assert.equal(parseInput("/" + name + " abc", "Main").kind, "error");
    assert.equal(
      parseDraft(
        {
          ...plainSnapshot("/" + name + " abc", "typed"),
          ranges: [{ start: 0, end: name.length + 5, source: "paste" }],
        },
        "Task",
      ).kind,
      "draft",
    );
  }
  assert.equal(parseInput("/search_task abc", "Task", true).kind, "error");
  assert.deepEqual(parseInput("/back", "Task", true), { kind: "back" });
  assert.equal(parseInput("Task instructions", "Task", true).kind, "draft");
});
test("argument completion replaces token only, preserves slash provenance and rejects stale reads", async () => {
  let live = "/search_task Ab";
  let resolve!: (ids: string[]) => void;
  const calls: number[][] = [];
  const provider = commandCompletion(
    () => "Task",
    () => true,
    (...n) => calls.push(n as number[]),
    async () => new Promise((r) => (resolve = r)),
    (s) => s === live,
  );
  const opts = { signal: new AbortController().signal };
  const pending = provider.getSuggestions([live], 0, live.length, opts);
  live = "/search_task X";
  resolve(["AbC-123"]);
  assert.equal(await pending, null);
  live = "/search_task Ab \t";
  const next = provider.getSuggestions([live], 0, 15, opts);
  resolve(["AbC-123"]);
  const suggestions = await next;
  assert(suggestions);
  const result = provider.applyCompletion(
    [live],
    0,
    15,
    suggestions.items[0],
    suggestions.prefix,
  );
  assert.deepEqual(result.lines, ["/search_task AbC-123 \t"]);
  assert.deepEqual(calls, [[2, 7, 13]]);
  const terminal = new VirtualTerminal(),
    tui = new TuiAltScreen(terminal);
  const editor = new DraftEditor(
    tui,
    () => "Task",
    async () => ["AbC-123"],
  );
  let submitted = 0;
  editor.onExplicitSubmit = () => submitted++;
  editor.handleInput("/search_task Ab");
  await new Promise((r) => setTimeout(r, 350));
  assert(editor.isShowingAutocomplete());
  editor.handleInput("\r");
  assert.equal(editor.getText(), "/search_task AbC-123");
  assert.equal(originAt(editor.snapshot(), 0), "typed");
  assert.equal(submitted, 0);
  editor.handleInput("\x1b[13;2u");
  assert.equal(submitted, 1);
});
