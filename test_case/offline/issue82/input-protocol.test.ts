import test from "node:test";
import assert from "node:assert/strict";
import { Editor, flatten } from "../../../src/pi_secretary/src/tui/editor.ts";
import { InputProtocol } from "../../../src/pi_secretary/src/tui/input.ts";
test("structured paste cannot dispatch and partial transactions cannot authorize actions", () => {
  const editor = new Editor(),
    input = new InputProtocol(() => editor),
    text = "/quit\r\n\u001b[201~\u0013\u009b\0中文";
  input.apply({ type: "begin", revision: 0, id: "paste-1", source: "paste" });
  assert.throws(
    () => input.apply({ type: "action", revision: 0, action: "submit" }),
    /INCOMPLETE/,
  );
  input.apply({ type: "chunk", revision: 0, id: "paste-1", index: 0, text });
  assert.deepEqual(
    input.apply({ type: "commit", revision: 0, id: "paste-1" }),
    { changed: true },
  );
  assert.equal(flatten(editor.draft.nodes), text.replace(/\r\n?/g, "\n"));
  assert.equal(editor.draft.nodes[0].kind, "paste");
  assert.throws(
    () => input.apply({ type: "action", revision: 0, action: "submit" }),
    /STALE_REVISION/,
  );
  assert.throws(
    () =>
      input.apply({
        type: "action",
        revision: 1,
        action: "submit",
        trusted: true,
      }),
    /INVALID_EVENT_FIELDS/,
  );
});
