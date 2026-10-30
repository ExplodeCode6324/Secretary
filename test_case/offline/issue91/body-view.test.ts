import test from "node:test";
import assert from "node:assert/strict";
import { Markdown, stripTerminalSequences } from "@earendil-works/pi-tui";
import {
  readMessageBody,
  ASSEMBLY_BYTES,
} from "../../../src/pi_secretary/src/tui/body.ts";
import {
  SourceMarkdown,
  markdownTheme,
  messageComponent,
  DocumentView,
  AnchoredScroll,
} from "../../../src/pi_secretary/src/tui/view.ts";
import type { Message } from "../../../src/pi_secretary/src/api/contracts.ts";
import type { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
const message = (text: string, thinking?: string): Message => ({
  id: "message:one",
  kind: "message",
  revision: "1",
  role: "assistant",
  text,
  thinking,
  call_id: null,
  incomplete: false,
  next_cursor: null,
  persistence: "durable",
});
function source(text: string, thought = "") {
  const fragment = (at: number) => ({
    ...message(
      text.slice(at * 4999, (at + 1) * 4999),
      thought.slice(at * 4999, (at + 1) * 4999),
    ),
    next_cursor:
      (at + 1) * 4999 < Math.max(text.length, thought.length)
        ? String(at + 1)
        : null,
  });
  let calls = 0;
  const client = {
    query: async <T>(path: string) => {
      calls++;
      return fragment(
        Number(new URL(path, "http://test").searchParams.get("cursor") ?? 0),
      ) as T;
    },
  } as Pick<CoreClient, "query">;
  return { client, first: fragment(0), calls: () => calls };
}

test("whole-body assembly counts combined UTF-8 bytes and oversized messages retain bounded traversable windows", async () => {
  const small = source("中".repeat(9000), "think".repeat(3000));
  const body = await readMessageBody(small.client, small.first, true);
  assert.equal(body.message.text, "中".repeat(9000));
  assert.equal(body.message.thinking, "think".repeat(3000));
  assert.equal(body.windowed, false);
  const huge = source(
    "```typescript\n" + "let value = 1;\n".repeat(100000) + "```\nend",
  );
  const first = await readMessageBody(huge.client, huge.first, false);
  assert.equal(first.windowed, true);
  assert(first.body.after);
  assert(Buffer.byteLength(first.body.text) <= ASSEMBLY_BYTES);
  assert(Buffer.byteLength(first.message.text) < ASSEMBLY_BYTES);
  const next = await readMessageBody(huge.client, huge.first, false, {
    windowed: true,
    targets: { body: first.body.nextStart },
    previous: first,
  });
  assert(next.body.before);
  assert(next.body.start > first.body.start);
  assert.equal(next.body.prefix, "```typescript\n");
  assert.equal(
    next.body.text,
    ("```typescript\n" + "let value = 1;\n".repeat(100000) + "```\nend").slice(
      next.body.start,
      next.body.start + next.body.text.length,
    ),
  );
  const previous = await readMessageBody(huge.client, huge.first, false, {
    windowed: true,
    targets: { body: 0 },
    previous: next,
  });
  assert.equal(previous.body.text, first.body.text);
});

test("partial coherent body is never returned after a cursor revision expires or generation changes", async () => {
  const f = source("中".repeat(22000));
  let valid = true;
  const query = f.client.query.bind(f.client);
  f.client.query = async <T>(route: string) => {
    const result = await query<T>(route);
    valid = false;
    return result;
  };
  await assert.rejects(
    readMessageBody(f.client, f.first, false, { valid: () => valid }),
    /BODY_SUPERSEDED/,
  );
  f.client.query = async <T>() => {
    throw Error("CURSOR_EXPIRED");
  };
  await assert.rejects(
    readMessageBody(f.client, f.first, false),
    /CURSOR_EXPIRED/,
  );
});

test("source-block mapping retains Pi formatting for ordered/loose lists, reference links, fences and pending LaTeX", () => {
  const samples = [
    "# Header\n\nparagraph **bold**\n\n7. seven\n8. eight\n\nend",
    "1. first\n\n   continuation\n\n2. second\n\nend",
    '[reference][r]\n\nmore\n\n[r]: https://example.com "title"',
    "before\n\n```ts\nconst a = 1;\n```\n\nafter",
    "before\n\n$$\nx^2 + y^2\n\n",
    "before\n\n\\[\nx^2+y^2\\]\n\nafter",
  ];
  for (const text of samples)
    for (const width of [8, 40, 100]) {
      const mapped = new SourceMarkdown(text),
        actual = mapped.render(width);
      const baseline = new Markdown(text, 0, 0, markdownTheme, {
        color: (value: string) => `\x1b[37m${value}\x1b[0m`,
      }).render(width);
      assert.deepEqual(actual.lines, baseline);
      assert.equal(actual.rows.length, actual.lines.length);
    }
  const spans = new SourceMarkdown("first\n\nsecond\n\nthird").render(40).rows;
  assert(spans.some((row) => row.block_start_utf16 === 7));
  assert(spans.some((row) => row.block_start_utf16 === 15));
});

test("CoT insertion preserves the exact body block and row at the same width; resize stays in that block", () => {
  const m = message(
    "first paragraph\n\n" +
      "second long paragraph 中文 ".repeat(20) +
      "\n\nlast",
    "reasoning\n".repeat(30),
  );
  const doc = new DocumentView(),
    scroll = new AnchoredScroll(doc);
  const render = (expanded: boolean, version: string, width = 40) => {
    doc.entries = [
      {
        id: m.id,
        version,
        component: messageComponent(m, expanded),
        revision: m.revision,
      },
    ];
    const rows = doc.render(width);
    scroll.updateLayout(rows.length, 8, () => {});
    return rows;
  };
  let lines = render(false, "1");
  scroll.scrollTo(8);
  const anchor = doc.anchor!;
  const line = stripTerminalSequences(lines[scroll.scrollTop]);
  assert.equal(anchor.region, "body");
  lines = render(true, "2");
  assert.equal(stripTerminalSequences(lines[scroll.scrollTop]), line);
  assert.equal(doc.anchor?.block_start_utf16, anchor.block_start_utf16);
  assert.equal(doc.anchor?.row_in_block, anchor.row_in_block);
  render(false, "3");
  assert.equal(doc.anchor?.row_in_block, anchor.row_in_block);
  render(false, "4", 20);
  assert.equal(doc.anchor?.block_start_utf16, anchor.block_start_utf16);
});

test("entering an evicted large body from below selects its final source window", async () => {
  const { RemoteViews } =
    await import("../../../src/pi_secretary/src/tui/remote.ts");
  const f = source("paragraph\n\n".repeat(100000) + "final marker\n"),
    remote = new RemoteViews({
      ...f.client,
      endpoint: { instance_id: "test" },
    } as CoreClient);
  try {
    remote.history.items.set(f.first.id, {
      ...f.first,
      text: "",
      next_cursor: null,
    });
    remote.history.evictedBodies.add(f.first.id);
    remote.history.setAnchor(f.first.id);
    await remote.loadBody(f.first.id, "body", "before");
    const body = remote.bodies.get(f.first.id)!;
    assert(body?.windowed);
    assert(body.body.start > 0);
    assert.equal(body.body.after, false);
    assert(body.body.text.endsWith("final marker\n"));
  } finally {
    remote.stop();
  }
});
