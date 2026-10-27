import test from "node:test";
import assert from "node:assert/strict";
import {
  TerminalStream,
  PASTE_START as S,
  PASTE_END as E,
  inputChunks,
  type TerminalFrame,
} from "../../../src/pi_secretary/src/tui/terminal-stream.ts";
const feed = (stream: TerminalStream, text: string) =>
  stream.feed(Buffer.from(text));
test("terminal stream decodes fragmented CJK/emoji once and frames benign paste as one data event", () => {
  const events: TerminalFrame[] = [],
    stream = new TerminalStream((e) => events.push(e));
  const text = "中文😀e\u0301\t\r\n/quit";
  for (const byte of Buffer.from(S + text + E))
    stream.feed(Uint8Array.of(byte));
  assert.deepEqual(events, [{ kind: "paste", text }]);
  stream.reset();
});
test("fatal invalid/incomplete UTF-8 refuses replacement characters and preserves previous events", () => {
  const events: TerminalFrame[] = [],
    stream = new TerminalStream((e) => events.push(e));
  feed(stream, "abc");
  stream.feed(Uint8Array.of(0xff));
  assert.equal(events[1].kind, "fault");
  stream.feed(Uint8Array.of(0xe4));
  stream.finish();
  assert.equal(events[2].kind, "fault");
  feed(stream, "恢复");
  assert.deepEqual(events.at(-1), { kind: "text", text: "恢复" });
  stream.reset();
});
test("overflow consumes all remaining paste controls until end and has a bounded liveness exit", async () => {
  const events: TerminalFrame[] = [],
    stream = new TerminalStream((e) => events.push(e), 8, 10, 32);
  feed(stream, S + "123456789\x13\x07");
  feed(stream, "\x03" + E);
  assert.deepEqual(
    events.map((x) => x.kind),
    ["fault"],
  );
  events.length = 0;
  feed(stream, S + "incomplete");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(events[0].kind, "fault");
  feed(stream, "next");
  assert.deepEqual(events.at(-1), { kind: "text", text: "next" });
  stream.reset();
});
test("stray end markers are paste data; same-read trailing controls are refused", () => {
  const events: TerminalFrame[] = [],
    stream = new TerminalStream((e) => events.push(e));
  feed(stream, E);
  assert.deepEqual(events, [{ kind: "paste", text: E }]);
  events.length = 0;
  feed(stream, S + "abc" + E + "\x13");
  assert.deepEqual(
    events.map((e) => e.kind),
    ["paste", "fault"],
  );
  stream.reset();
});
test("expected provenance limitation: split hostile terminator leaves later control bytes indistinguishable", () => {
  const events: TerminalFrame[] = [],
    stream = new TerminalStream((e) => events.push(e));
  feed(stream, S + "abc" + E);
  feed(stream, "\x13");
  assert.deepEqual(events, [
    { kind: "paste", text: "abc" },
    { kind: "key", text: "\x13" },
  ]);
  stream.reset(); // Witness of C2/C3, not an authenticated-paste PASS.
});
test("normal key sequences and huge typed bursts preserve exact UTF-8 with bounded chunks", () => {
  const events: TerminalFrame[] = [],
    stream = new TerminalStream((e) => events.push(e));
  for (const part of ["\x1b[", "1;2D", "\r\x13"]) feed(stream, part);
  assert.deepEqual(
    events.map((e) => ("text" in e ? e.text : "")),
    ["\x1b[1;2D", "\r", "\x13"],
  );
  const text = "中😀".repeat(30000),
    chunks = [...inputChunks(text)];
  assert.equal(chunks.join(""), text);
  assert.ok(chunks.every((x) => Buffer.byteLength(x) <= 65536));
  stream.reset();
});
test("consecutive paste frames and fragmented next start retain independent data boundaries", () => {
  for (const split of [0, 1, 3, S.length]) {
    const events: TerminalFrame[] = [],
      stream = new TerminalStream((e) => events.push(e));
    feed(stream, S + "first" + E + S.slice(0, split));
    feed(stream, S.slice(split) + "第二" + E);
    assert.deepEqual(events, [
      { kind: "paste", text: "first" },
      { kind: "paste", text: "第二" },
    ]);
    stream.reset();
  }
});
