import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shouldSend,
  safeDraft,
  render,
  phaseFrames,
  loadFixture,
  streamChunk,
} from "../src/study";
test("WebKit candidate-confirm Enter is not a send after compositionend", () => {
  const enter = {
    key: "Enter",
    shiftKey: false,
    isComposing: false,
    keyCode: 229,
  };
  assert.equal(shouldSend(enter, false), false);
  assert.equal(shouldSend({ ...enter, keyCode: 13 }, false), true);
  assert.equal(shouldSend({ ...enter, keyCode: 13 }, true), false);
  assert.equal(
    shouldSend({ ...enter, keyCode: 13, isComposing: true }, false),
    false,
  );
  assert.equal(
    shouldSend({ ...enter, keyCode: 13, shiftKey: true }, false),
    false,
  );
});
test("draft preserves exact committed text and blocks composition", () => {
  const text = "中文，English。\n第二行";
  assert.equal(safeDraft(text, false), text);
  assert.equal(safeDraft(text, true), null);
  assert.equal(safeDraft("  ", false), null);
});
test("Markdown cannot introduce executable HTML or network images/links", () => {
  const html = render(
    "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n![remote](https://example.org/a.png)\n\n[link](https://example.org/)\n\n[x](javascript:alert(1))",
  );
  assert.ok(!/<script|<img|<a\s/i.test(html));
  assert.ok(html.includes("&lt;script&gt;"));
});
test("fixture carries 1000 variable rows and full long code", () => {
  const rows = loadFixture();
  assert.equal(rows.length, 1000);
  assert.equal(new Set(rows.map((x) => x.id)).size, 1000);
  assert.ok(rows[40].source.includes("line9999"));
  assert.equal(Buffer.byteLength(rows[80].source), 102400);
  assert.equal(streamChunk.length, 32);
});
test("three distinct displaced logical frames return to identity", () => {
  assert.deepEqual(phaseFrames[0], [0, 0, 0]);
  assert.equal(new Set(phaseFrames.slice(1).map((x) => x.join())).size, 3);
});
