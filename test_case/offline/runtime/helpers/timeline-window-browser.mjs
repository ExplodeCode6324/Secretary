import fs from "node:fs";
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const endpoint = JSON.parse(fs.readFileSync(process.argv[2], "utf8")),
  out = process.argv[3];
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [],
  errors = [],
  payloads = [];
let visited = new Set();
const context = await browser.newContext({
    viewport: { width: 1280, height: 950 },
  }),
  page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", async (r) => {
  if (r.url().endsWith("/api/timeline"))
    try {
      const buffer = await r.body();
      payloads.push(buffer.length);
      for (const item of JSON.parse(buffer).items ?? []) visited.add(item.id);
    } catch {}
});
const call = async (route, body) => {
  const r = await fetch(endpoint.url + "/api/" + route, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${endpoint.token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert(r.ok, await r.clone().text());
  return r.json();
};
const report = () =>
  fs.writeFileSync(
    out + "/result.json",
    JSON.stringify(
      {
        chrome: browser.version(),
        results,
        errors,
        max_response_bytes: Math.max(...payloads),
        requests: payloads.length,
      },
      null,
      2,
    ),
  );
async function ready() {
  await page.goto(endpoint.url + "/#" + endpoint.token);
  await page.waitForSelector("[data-timeline-id]");
  // Test instrumentation only; capture the actual application instance on its next tick.
  await page.evaluate(async () => {
    const { TimelineView } = await import("/timeline-view.js");
    const sync = TimelineView.prototype.sync;
    TimelineView.prototype.sync = function (...args) {
      window.probe = this;
      return sync.apply(this, args);
    };
  });
  await page.waitForFunction(() => window.probe);
}
async function bounds() {
  const m = await page.evaluate(() => ({
    cached: probe.cache.items.length,
    bytes: probe.cache.bytes,
    mounted: document.querySelectorAll("[data-timeline-id]").length,
    heights: probe.heights.size,
    nodeMap: probe.nodes.size,
    pending: probe.pending.size,
    unique: new Set(probe.cache.items.map((m) => m.id)).size,
  }));
  assert(m.cached <= 2000);
  assert(m.bytes <= 16 * 1024 * 1024);
  assert(m.mounted <= 150);
  assert(m.heights <= 2000);
  assert.equal(m.mounted, m.nodeMap);
  assert.equal(m.unique, m.cached);
  return m;
}
async function frame() {
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}
try {
  await ready();
  await bounds();
  const { client } = await call("client", {});
  if (!process.env.WINDOW_STRESS_ONLY) {
    // Fragment window, no hidden full body or script execution.
    await page.evaluate(async () => {
      const item = probe.cache.items.find((m) =>
        m.text?.startsWith("LONG_BODY_START"),
      );
      if (item) await probe.open(item.id);
    });
    await page
      .locator(".fragment-controls button", { hasText: "继续加载内容" })
      .click();
    await page.waitForFunction(() =>
      probe.cache.items.some((m) => m.textOffset > 0),
    );
    assert(!(await page.evaluate(() => !!window.alerted)));
    results.push({ fragments: true, ...(await bounds()) });
    await page.evaluate(() => probe.open());
    let loaded = 0;
    for (let i = 0; i < 35; i++) {
      const result = await page.evaluate(async () => {
        const v = probe;
        v.follow = false;
        v.anchor = null;
        v.scroller.scrollTop = 0;
        await new Promise(requestAnimationFrame);
        while (v.pending.size) await new Promise(requestAnimationFrame);
        const before = v.cache.items[0]?.id;
        await v.load("before");
        return {
          before,
          after: v.cache.items[0]?.id,
          hasBefore: !!v.cache.before,
        };
      });
      await frame();
      await bounds();
      if (result.before !== result.after) loaded += 200;
      if (!result.hasBefore) break;
    }
    loaded = visited.size;
    results.push({
      navigation_debug: await page.evaluate(() => ({
        paused: probe.paused,
        anchor: probe.anchor,
        protected: [...probe.protectedIDs()],
        first: probe.cache.items[0]?.id,
        last: probe.cache.items.at(-1)?.id,
        top: probe.scroller.scrollTop,
        text: probe.notice.textContent,
        nodeKeys: [...probe.nodes.keys()].slice(0, 3),
        focused: document.activeElement.outerHTML.slice(0, 200),
      })),
    });
    assert(loaded >= 5000, `only paged ${loaded}`);
    results.push({ upward_entries: loaded, ...(await bounds()) });
    visited = new Set();
    let down = 0;
    for (let i = 0; i < 35; i++) {
      const result = await page.evaluate(async () => {
        const v = probe;
        v.follow = false;
        v.anchor = null;
        v.scroller.scrollTop = v.scroller.scrollHeight;
        await new Promise(requestAnimationFrame);
        while (v.pending.size) await new Promise(requestAnimationFrame);
        const before = v.cache.items.at(-1)?.id;
        await v.load("after");
        return {
          before,
          after: v.cache.items.at(-1)?.id,
          hasAfter: !!v.cache.after,
        };
      });
      await frame();
      await bounds();
      if (result.before !== result.after) down += 200;
      if (!result.hasAfter) break;
    }
    down = visited.size;
    assert(down >= 3800, `only paged down ${down}`);
    results.push({ downward_entries: down, ...(await bounds()) });
    await page.evaluate(() => probe.open());
    await frame();
    for (const [streaming, thinking] of [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ]) {
      await page.locator("#display-streaming").setChecked(streaming);
      await page.locator("#display-thinking").setChecked(thinking);
      await page.waitForFunction(() => probe.revision != null);
      await page.locator("#message").fill("synthetic window stream probe");
      await page.locator("#send").click();
      await page.waitForFunction(() =>
        probe.cache.items.some((m) => m.running),
      );
      const callID = await page.evaluate(
        () => probe.cache.items.find((m) => m.running)?.call_id,
      );
      await page.waitForFunction(
        (id) =>
          probe.cache.items.some(
            (m) =>
              m.call_id === id && !m.running && m.text.includes("逐段输出"),
          ),
        callID,
      );
      assert.equal(
        await page.evaluate(
          (id) => probe.cache.items.filter((m) => m.call_id === id).length,
          callID,
        ),
        1,
      );
      if (!thinking)
        assert.equal(await page.locator(".message-thinking").count(), 0);
      assert(
        !(await page.locator("#messages").innerText()).includes(
          "PRIVATE_SIGNATURE",
        ),
      );
      results.push({
        streaming,
        thinking,
        call_identity: true,
        ...(await bounds()),
      });
    }
    // Real scroll, independent draft and anchor through new messages and viewport resize.
    await page.locator("#message").fill("中文草稿，保留输入");
    await page.locator("#message").evaluate((n) => n.setSelectionRange(2, 5));
    await page.evaluate(() => {
      probe.scroller.scrollTop = Math.max(0, probe.scroller.scrollTop - 2200);
    });
    await frame();
    const anchor = await page.evaluate(() => probe.capture());
    assert(anchor);
    await call("message", {
      client,
      text: "new while reading history",
      request_id: crypto.randomUUID(),
    });
    await page.waitForFunction(
      () => !document.querySelector(".timeline-latest").hidden,
    );
    await frame();
    const drift = await page.evaluate((a) => {
      const n = probe.nodes.get(a.id);
      return n
        ? Math.abs(
            n.getBoundingClientRect().top -
              probe.scroller.getBoundingClientRect().top -
              a.offset,
          )
        : Infinity;
    }, anchor);
    assert(drift <= 4, `new message anchor drift ${drift}`);
    assert.equal(
      await page.locator("#message").inputValue(),
      "中文草稿，保留输入",
    );
    const selection = await page
      .locator("#message")
      .evaluate((n) => [n.selectionStart, n.selectionEnd]);
    assert.deepEqual(selection, [2, 5]);
    const resizeAnchor = await page.evaluate(() => probe.capture());
    await page.setViewportSize({ width: 390, height: 844 });
    await frame();
    await frame();
    const resizeDrift = await page.evaluate((a) => {
      const n = probe.nodes.get(a.id);
      return n
        ? Math.abs(
            n.getBoundingClientRect().top -
              probe.scroller.getBoundingClientRect().top -
              a.offset,
          )
        : Infinity;
    }, resizeAnchor);
    assert(resizeDrift <= 4, `resize drift ${resizeDrift}`);
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({ path: out + "/mobile.png" });
    results.push({
      draft_selection: true,
      incoming_anchor_drift_px: drift,
      resize_anchor_drift_px: resizeDrift,
      mobile: true,
    });
    await context.setOffline(true);
    await page.waitForFunction(() =>
      document
        .querySelector(".activity-connection")
        .textContent.includes("中断"),
    );
    await context.setOffline(false);
    await page.waitForFunction(
      () => document.querySelector(".activity-connection").textContent === "",
    );
    results.push({ reconnect: true });
  }
  // Ten minute stress uses the same controller, real paging, updates, and GC heap samples.
  await page.setViewportSize({ width: 1280, height: 950 });
  const duration = Number(process.env.WINDOW_STRESS_MS ?? 600000),
    start = Date.now(),
    samples = [],
    cdp = await context.newCDPSession(page);
  let round = 0;
  while (Date.now() - start < duration) {
    await page.evaluate(async (round) => {
      const v = probe;
      v.follow = false;
      v.anchor = null;
      v.scroller.scrollTop = round % 2 ? v.scroller.scrollHeight : 0;
      await new Promise(requestAnimationFrame);
      await v.load(round % 2 ? "after" : "before");
      if (!v.cache.before || round % 30 === 0) await v.open();
    }, round++);
    if (round % 12 === 0) {
      await cdp.send("HeapProfiler.collectGarbage");
      const h = await cdp.send("Runtime.getHeapUsage");
      samples.push({
        seconds: (Date.now() - start) / 1000,
        heap_bytes: h.usedSize,
        ...(await bounds()),
      });
      report();
    }
    if (round % 50 === 0)
      await call("message", {
        client,
        text: "synthetic soak update",
        request_id: crypto.randomUUID(),
      });
    // Cadence models reading time; correctness waits above are request/frame based.
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(errors.length, 0, errors.join("\n"));
  assert(Math.max(...payloads) <= 1048576);
  results.push({
    stress_duration_ms: Date.now() - start,
    rounds: round,
    samples,
  });
  await page.screenshot({ path: out + "/desktop.png" });
  report();
} catch (e) {
  results.push({ failure: String(e), stack: e.stack });
  await page.screenshot({ path: out + "/failure.png" }).catch(() => {});
  report();
  throw e;
} finally {
  await browser.close();
}
