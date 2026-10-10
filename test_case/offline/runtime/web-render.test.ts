import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { serve } from "../../../src/pi_secretary/src/backend.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";

const source = fs.readFileSync(
  new URL("../../../src/pi_secretary/web/markdown.js", import.meta.url),
  "utf8",
);
const { renderMarkdown, safeLink } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
// Minimal recording DOM: deliberately offers no HTML parser or event execution.
// Browser integration is separately exercised against the real module and app.
class Node {
  children: Node[] = [];
  attributes: Record<string, string> = {};
  value = "";
  className = "";
  constructor(
    public tag: string,
    public ownerDocument: Document,
  ) {}
  append(...nodes: Node[]) {
    for (const node of nodes)
      this.children.push(
        ...(node.tag === "#fragment" ? node.children : [node]),
      );
  }
  replaceChildren(...nodes: Node[]) {
    this.children = [];
    this.value = "";
    this.append(...nodes);
  }
  set textContent(text: string) {
    this.children = [];
    this.value = text;
  }
  get textContent(): string {
    return this.value + this.children.map((node) => node.textContent).join("");
  }
  setAttribute(key: string, value: string) {
    this.attributes[key] = value;
  }
  all(tag: string): Node[] {
    return this.children.flatMap((node) => [
      ...(node.tag === tag ? [node] : []),
      ...node.all(tag),
    ]);
  }
}
class Document {
  createElement(tag: string) {
    return new Node(tag, this);
  }
  createTextNode(text: string) {
    const node = new Node("#text", this);
    node.textContent = text;
    return node;
  }
  createDocumentFragment() {
    return new Node("#fragment", this);
  }
}
function render(text: string) {
  const document = new Document(),
    root = document.createElement("div");
  renderMarkdown(root, text);
  return root;
}
const attack = `<script>globalThis.compromised = true</script>\n<img src=x onerror=alert(1)>\n<svg onload=alert(1)>\n<a href="javascript:alert(1)">HTML</a>\n[bad](javascript:alert) [data](data:text/html,test) [file](file:///tmp/x) [protocol](//evil.test) [entity](jav&#x61;script:alert) [encoded](%6aavascript:alert) ![tracking](https://evil.test/pixel)`;
function assertSafe(root: Node) {
  const allowed = new Set([
    "#text",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "strong",
    "em",
    "code",
    "pre",
    "ul",
    "ol",
    "li",
    "blockquote",
    "hr",
    "div",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "a",
  ]);
  const visit = (node: Node) => {
    assert(allowed.has(node.tag), node.tag);
    for (const name of Object.keys(node.attributes)) assert(!/^on/i.test(name));
    if (node.tag === "a") {
      assert.equal(safeLink(node.attributes.href), node.attributes.href);
      assert.equal(node.attributes.rel, "noopener noreferrer");
      assert.equal(node.attributes.target, "_blank");
    }
    node.children.forEach(visit);
  };
  visit(root);
}

test("structured prose creates semantic headings, nested lists, quotes, code and aligned tables", () => {
  const root = render(
    "# 一级\n## 二级\n### 三级\n#### 四级\n##### 五级\n###### 六级\n\n正文 **粗体** 与 *强调* 和 `a<b`\n下一行\n\n3. 第三项\n   - 子项\n   - **子项二**\n4. 第四项\n\n> 引用\n>\n> - 引用列表\n\n---\n\n| 项目 | 数值 | 状态 |\n| :--- | ---: | :---: |\n| A\\|B | **12** | 完成 |\n\n```html\n<script>literal</script>\n````",
  );
  for (let level = 1; level <= 6; level++)
    assert.equal(root.all("h" + level).length, 1);
  assert.equal(root.all("ol")[0].attributes.start, "3");
  assert.equal(root.all("ol")[0].all("ul").length, 1);
  assert.equal(root.all("blockquote")[0].all("ul").length, 1);
  assert.equal(root.all("hr").length, 1);
  assert.equal(root.all("table").length, 1);
  assert.equal(root.all("th")[1].className, "align-right");
  assert.equal(root.all("th")[2].className, "align-center");
  assert.equal(root.all("td")[0].textContent, "A|B");
  assert.equal(
    root.all("pre")[0].all("code")[0].textContent,
    "<script>literal</script>",
  );
  assert.match(root.all("p")[0].textContent, /下一行/);
  assertSafe(root);
});

test("raw HTML, images and unsafe destinations are inert readable text", () => {
  const root = render(attack);
  assert.equal(root.all("a").length, 0);
  assert(root.textContent.includes("<script>"));
  assert(root.textContent.includes("![tracking](https://evil.test/pixel)"));
  assertSafe(root);
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,x",
    "vbscript:msgbox",
    "file:///x",
    "//evil.test",
    "/api/shutdown",
    "https:\\evil.test",
    "https://user:password@example.com",
    "https://exa\nmple.com",
    "mailto:x@y.test?bcc=z@y.test",
    "https://example.com/%0d%0aheader",
  ])
    assert.equal(safeLink(url), null, url);
  const safe = render(
    "[网站](https://example.com/a?b=1&c=2) [邮件](mailto:person@example.com) [HTTP](http://example.com)",
  );
  assert.equal(safe.all("a").length, 3);
  assertSafe(safe);
});

test("every streaming prefix stays safe; replacement converges to complete structured output", () => {
  const text =
    "# 流式\n\n**粗体**\n\n" +
    attack +
    "\n\n[安全](https://example.com)\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n~~~js\n<script>literal</script>\n~~~";
  const root = render("");
  for (let index = 0; index <= text.length; index++) {
    renderMarkdown(root, text.slice(0, index));
    assertSafe(root);
  }
  assert.equal(root.all("h1").length, 1);
  assert.equal(root.all("table").length, 1);
  assert.equal(root.all("a").length, 1);
  assert.equal(root.all("pre").length, 1);
  assert.equal(root.textContent, render(text).textContent);
  renderMarkdown(root, "");
  assert.equal(root.children.length, 0);
});

test("incomplete fences and malformed table rows preserve content; recursion is bounded", () => {
  assert.equal(
    render("```js\nconst x = '<img>';\n``").all("pre")[0].textContent,
    "const x = '<img>';\n``",
  );
  const root = render(
    "| A | B |\n| --- | --- |\n| one | two | extra |\n[open](https://exam",
  );
  assert(root.textContent.includes("extra"));
  assert(root.textContent.includes("[open](https://exam"));
  assert.equal(root.all("a").length, 0);
  assertSafe(render("> ".repeat(10000) + "deep"));
});

// API v1 retires this legacy UI contract; replacement coverage: offline/issue8 and docs/api/v1/verification.md.
test.skip("backend serves the renderer module through its explicit static allowlist", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-render-"));
  const app = await App.open(directory, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  const backend = await serve(app);
  try {
    const response = await fetch(backend.endpoint.url + "/markdown.js");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type")!, /text\/javascript/);
    assert.match(
      response.headers.get("content-security-policy")!,
      /script-src 'self'/,
    );
    assert.equal(await response.text(), source);
    assert.equal((await fetch(backend.endpoint.url + "/other.js")).status, 404);
    const appSource = await (
      await fetch(backend.endpoint.url + "/app.js")
    ).text();
    assert.match(
      appSource,
      /import \{ TimelineView \} from "\.\/timeline-view.js"/,
    );
    const timelineResponse = await fetch(
      backend.endpoint.url + "/timeline-view.js",
    );
    assert.equal(timelineResponse.status, 200);
    const timelineSource = await timelineResponse.text();
    assert.match(
      timelineSource,
      /import \{ renderMarkdown \} from "\.\/markdown.js"/,
    );
    assert.match(timelineSource, /renderMarkdown\(body, item.text\)/);
    assert.equal(
      (await fetch(backend.endpoint.url + "/timeline-window.js")).status,
      200,
    );
  } finally {
    await backend.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("large unfinished inline delimiters remain literal without quadratic retries", () => {
  const length = 100_000;
  const inputs = [
    "prefix " + "[".repeat(length),
    "prefix " + "`".repeat(length),
    "prefix " + "`".repeat(length / 2) + "code" + "`".repeat(length / 2 - 1),
    "prefix **" + "a".repeat(length),
    "prefix __" + "a".repeat(length),
    "prefix " + "_a ".repeat(length / 3),
  ];
  for (const input of inputs) {
    const start = performance.now();
    const root = render(input);
    const elapsed = performance.now() - start;
    // Generous guard: the original repeated '[' case needs ~6 s at this size.
    // Corrected cases are <10 ms locally; avoid tight hardware-sensitive ratios.
    assert(elapsed < 1000, `unfinished input took ${elapsed.toFixed(1)} ms`);
    assert.equal(root.textContent, input);
    assert.equal(root.all("a").length, 0);
    assert.equal(root.all("code").length, 0);
  }
  const root = render("Valid `one` and ``two``; unfinished ``three`");
  assert.deepEqual(
    root.all("code").map((node) => node.textContent),
    ["one", "two"],
  );
  assert.equal(root.textContent, "Valid one and two; unfinished ``three`");
});
