import test from "node:test";
import assert from "node:assert/strict";
import { TuiAltScreen } from "@earendil-works/pi-tui";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import {
  DraftEditor,
  configureKeys,
  parseDraft,
} from "../../../src/pi_secretary/src/tui/input.ts";
import { plainSnapshot } from "../../../src/pi_secretary/src/tui/draft.ts";

function editor() {
  configureKeys();
  return new DraftEditor(new TuiAltScreen(new VirtualTerminal()), () => "Main");
}
function paste(target: DraftEditor, text: string) {
  target.handleInput("\x1b[200~" + text + "\x1b[201~");
}

test("typed slash parses long pasted paths from their retained payload", () => {
  for (const argument of [
    "--execution 51cfd79a-9d25-4006-9439-6405960d4681 report.txt",
    "/Users/test/very-long-working-directory/中文 目录/Report With Spaces.txt",
  ]) {
    const e = editor();
    e.handleInput("/");
    paste(e, "OpEn " + argument);
    assert(e.snapshot().ranges.some((r) => r.block));
    const saved = JSON.parse(JSON.stringify(e.snapshot()));
    assert.deepEqual(parseDraft(saved, "Main"), {
      kind: "open",
      path: argument,
    });
    const restored = editor();
    restored.restore(saved);
    assert.deepEqual(parseDraft(restored.snapshot(), "Main"), {
      kind: "open",
      path: argument,
    });
    assert.equal(parseDraft(saved, "Task").kind, "error");
  }
});

test("expanded command arguments retain newline validation and pasted command provenance", () => {
  const longCommand =
    "/open /Users/test/" + "directory/".repeat(12) + "Report.txt";
  const allPasted = editor();
  paste(allPasted, longCommand);
  assert.deepEqual(parseDraft(allPasted.snapshot(), "Main"), {
    kind: "send",
    text: longCommand,
  });
  assert.equal(parseDraft(plainSnapshot(longCommand), "Main").kind, "error");
  const malformed = editor();
  malformed.handleInput("/");
  paste(malformed, longCommand.slice(1) + "\n/help");
  assert.equal(parseDraft(malformed.snapshot(), "Main").kind, "error");
  const message = editor();
  message.handleInput("/");
  paste(message, "rawmessage " + longCommand + "\nsecond line");
  assert.deepEqual(parseDraft(message.snapshot(), "Main"), {
    kind: "send",
    text: longCommand + "\nsecond line",
  });
});
