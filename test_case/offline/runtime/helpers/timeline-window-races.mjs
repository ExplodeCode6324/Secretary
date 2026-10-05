import fs from "node:fs";
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const e = JSON.parse(fs.readFileSync(process.argv[2], "utf8")),
  out = process.argv[3];
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  context = await browser.newContext({
    viewport: { width: 1280, height: 950 },
  }),
  page = await context.newPage(),
  results = [],
  errors = [];
page.on("pageerror", (x) => errors.push(x.message));
try {
  await page.goto(e.url + "/#" + e.token);
  await page.waitForSelector("[data-timeline-id]");
  await page.evaluate(async () => {
    const { TimelineView } = await import("/timeline-view.js");
    const sync = TimelineView.prototype.sync;
    TimelineView.prototype.sync = function (...args) {
      window.probe = this;
      return sync.apply(this, args);
    };
  });
  await page.waitForFunction(() => window.probe);
  // Return an intentionally stale thinking response after the preference changed.
  await page.locator("#display-thinking").setChecked(true);
  await page.waitForFunction(() => probe.revision != null);
  await page.evaluate(() => {
    const v = probe,
      request = v.request;
    let hold = true;
    v.request = async (...args) => {
      const response = await request(...args);
      if (hold && args[0].thinking) {
        hold = false;
        v.held = true;
        await new Promise((r) => (v.release = r));
      }
      return response;
    };
    void v.open();
  });
  await page.waitForFunction(() => probe.held);
  await page.locator("#display-thinking").setChecked(false);
  await page.waitForFunction(() => probe.revision != null);
  await page.evaluate(() => probe.release());
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  assert.equal(await page.locator(".message-thinking").count(), 0);
  assert(
    await page.evaluate(() => probe.cache.items.every((m) => !m.thinking)),
  );
  results.push({ stale_preference_response_rejected: true });
  // Independent display preference in another real client.
  const other = await context.newPage();
  await other.goto(e.url + "/#" + e.token);
  await other.waitForSelector("[data-timeline-id]");
  await other.locator("#display-thinking").setChecked(true);
  await other.waitForSelector(".message-thinking");
  assert.equal(await page.locator("#display-thinking").isChecked(), false);
  await other.close();
  results.push({ two_clients_independent: true });
  // Both directions may finish out of order. Cache merge is by stable ID and revision.
  await page.evaluate(async () => {
    const v = probe;
    const id = v.cache.items[10].id;
    await v.open(id);
    v.follow = false;
    v.anchor = null;
  });
  const race = await page.evaluate(async () => {
    const v = probe,
      request = v.request,
      releases = {};
    v.request = async (...args) => {
      const response = await request(...args);
      if (args[0].cursor && args[0].direction)
        await new Promise((r) => (releases[args[0].direction] = r));
      return response;
    };
    const before = v.load("before"),
      after = v.load("after");
    const start = performance.now();
    while (
      (!releases.before || !releases.after) &&
      performance.now() - start < 5000
    )
      await new Promise(requestAnimationFrame);
    if (releases.after) releases.after();
    if (releases.before) releases.before();
    await Promise.all([before, after]);
    v.request = request;
    return {
      count: v.cache.items.length,
      unique: new Set(v.cache.items.map((m) => m.id)).size,
      sorted: v.cache.items.every(
        (m, i, rows) => !i || rows[i - 1].order <= m.order,
      ),
      directions: Object.keys(releases),
    };
  });
  assert.equal(race.count, race.unique);
  assert(race.sorted);
  assert(race.count <= 2000);
  assert.deepEqual(race.directions.sort(), ["after", "before"]);
  results.push({ out_of_order: race });
  // Response-to-paint latency through the real renderer, 100 scattered positions in the loaded history.
  const ids = await page.evaluate(() =>
    probe.cache.items
      .filter((m) => !m.text?.startsWith("LONG_BODY_START"))
      .map((m) => m.id),
  );
  const times = [];
  for (let i = 0; i < 100; i++)
    times.push(
      await page.evaluate(
        async (id) => {
          const v = probe,
            request = v.request;
          let responseAt;
          v.request = async (...args) => {
            const result = await request(...args);
            if (args[0].locate === id) responseAt = performance.now();
            return result;
          };
          await v.open(id);
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          );
          v.request = request;
          return performance.now() - responseAt;
        },
        ids[(i * 97) % ids.length],
      ),
    );
  times.sort((a, b) => a - b);
  assert(times[95] <= 300, `paint P95 ${times[95]}`);
  results.push({
    response_to_visible: {
      queries: times.length,
      p50_ms: times[50],
      p95_ms: times[95],
      max_ms: times.at(-1),
    },
  });
  // Browser selection survives in-place rendering of unchanged history.
  const selection = await page.evaluate(() => {
    const v = probe,
      node = v.root.querySelector(".message-body p");
    const text = [...node.childNodes].find((n) => n.nodeType === 3);
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(8, text.textContent.length));
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const selected = selection.toString();
    v.render();
    return { selected, after: selection.toString() };
  });
  assert(selection.selected.length);
  assert.equal(selection.selected, selection.after);
  results.push({ text_selection: true });
  await page.evaluate(() => getSelection().removeAllRanges());
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    out + "/result.json",
    JSON.stringify({ results, errors }, null, 2),
  );
} catch (err) {
  results.push({ failure: String(err), stack: err.stack });
  fs.writeFileSync(
    out + "/result.json",
    JSON.stringify({ results, errors }, null, 2),
  );
  throw err;
} finally {
  await browser.close();
}
