// Native-input regression: never preset follow=false or scrollTop to leave the tail.
import fs from "node:fs";
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const endpoint = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = process.argv[3];
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
const results = [],
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const frames = () =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
      ),
  );
const state = () =>
  page.evaluate(() => ({
    top: probe.scroller.scrollTop,
    distance:
      probe.scroller.scrollHeight -
      probe.scroller.clientHeight -
      probe.scroller.scrollTop,
    follow: probe.follow,
    anchor: probe.capture(),
  }));
async function wheel(delta) {
  const box = await page.locator("#timeline").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const n = await page.evaluate(() => window.scrollEvents);
  await page.mouse.wheel(0, delta);
  await page.waitForFunction((n) => window.scrollEvents > n, n);
  await frames();
  return state();
}
async function settledScroll() {
  // Native keyboard scroll animates beyond the first scroll event. Do not click
  // latest while the preceding browser gesture still has queued animation frames.
  await page.waitForFunction(() => {
    const top = probe.scroller.scrollTop;
    const previous = window.scrollSettle;
    window.scrollSettle = {
      top,
      frames:
        previous?.top === top && !probe.pending.size ? previous.frames + 1 : 0,
    };
    return window.scrollSettle.frames >= 8;
  });
}
async function latest() {
  await page.evaluate(() => {
    window.scrollSettle = null;
  });
  await settledScroll();
  // Use the actual public action when detached; initial page already follows.
  if (await page.locator(".timeline-latest").isVisible())
    await page.locator(".timeline-latest").click();
  await page.waitForFunction(
    () => probe.follow && probe.atBottom() && !probe.pending.size,
  );
  await frames();
}
async function drift(anchor) {
  return page.evaluate((a) => {
    const node = probe.nodes.get(a.id);
    return node
      ? Math.abs(
          node.getBoundingClientRect().top -
            probe.scroller.getBoundingClientRect().top -
            a.offset,
        )
      : Infinity;
  }, anchor);
}
async function call(route, body) {
  const response = await fetch(endpoint.url + "/api/" + route, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${endpoint.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  assert(response.ok, await response.clone().text());
  return response.json();
}
try {
  await page.goto(endpoint.url + "/#" + endpoint.token);
  await page.waitForSelector("[data-timeline-id]");
  await page.evaluate(async () => {
    const { TimelineView } = await import("/timeline-view.js");
    const sync = TimelineView.prototype.sync;
    TimelineView.prototype.sync = function (...args) {
      window.probe = this;
      return sync.apply(this, args);
    };
    window.scrollEvents = 0;
    window.scrollEnds = 0;
    document.querySelector("#timeline").addEventListener("scrollend", () => {
      window.scrollEnds++;
    });
    document
      .querySelector("#timeline")
      .addEventListener("scroll", () => window.scrollEvents++);
  });
  await page.waitForFunction(() => window.probe);
  await latest();
  for (const amount of [20, 1, 5, 40, 80]) {
    await latest();
    const before = await state();
    const after = await wheel(-amount);
    results.push({ wheel_up_px: amount, before, after });
    assert.equal(
      after.follow,
      false,
      `first ${amount}px upward wheel must detach`,
    );
    assert(after.top < before.top, `first ${amount}px upward wheel was undone`);
  }
  await latest();
  const repeated = [];
  for (let i = 0; i < 3; i++) {
    const before = await state(),
      after = await wheel(-20);
    assert.equal(after.follow, false);
    assert(after.top < before.top, "each upward gesture must move immediately");
    repeated.push(after.top);
  }
  // A downward gesture still short of the bottom must not re-enable follow.
  const near = await wheel(20);
  assert(near.distance > 2 && near.distance < 100);
  assert.equal(near.follow, false);
  const bottom = await wheel(100);
  assert.equal(bottom.follow, true);
  assert(bottom.distance <= 2);
  results.push({
    repeated_wheel_positions: repeated,
    near_bottom_stays_detached: true,
    actual_bottom_resumes: true,
  });

  // Native keyboard input uses the same scroll path.
  await page.locator("#timeline").evaluate((n) => {
    n.tabIndex = 0;
    n.focus();
  });
  const keyboardBefore = await state();
  const endsBefore = await page.evaluate(() => window.scrollEnds);
  await page.keyboard.press("ArrowUp");
  await page.waitForFunction(() => !probe.follow);
  await page.waitForFunction((ends) => window.scrollEnds > ends, endsBefore);
  await page.evaluate(() => {
    window.scrollSettle = null;
  });
  await settledScroll();
  const keyboardAfter = await state();
  assert((await state()).distance > 2);
  await page.keyboard.press("Control+End");
  // macOS Chrome supports Meta+ArrowDown as well; public latest action is separately checked.
  await latest();
  results.push({
    keyboard_up_detaches: true,
    latest_action_resumes: true,
    keyboardBefore,
    keyboardAfter,
    native_scrollend_observed: true,
  });

  // Ongoing real fixture stream must respect a user's first small upward gesture.
  const { client } = await call("client", {});
  await call("message", {
    client,
    text: "synthetic scroll regression stream",
    request_id: crypto.randomUUID(),
  });
  await page.waitForFunction(() => probe.cache.items.some((m) => m.running));
  await frames();
  const id = await page.evaluate(
    () => probe.cache.items.find((m) => m.running).call_id,
  );
  await wheel(-40);
  const reading = await state();
  assert.equal(reading.follow, false);
  await page.waitForFunction(
    (id) =>
      probe.cache.items.some(
        (m) => m.call_id === id && !m.running && m.text.includes("逐段输出"),
      ),
    id,
  );
  await frames();
  const streamDrift = await drift(reading.anchor);
  assert.equal((await state()).follow, false);
  assert(streamDrift <= 4, `stream anchor drift ${streamDrift}`);
  results.push({
    stream_completed_while_detached: true,
    anchor_drift_px: streamDrift,
  });

  // Programmatic resize correction (and its delayed scroll event) must not resume follow.
  const resizeAnchor = (await state()).anchor;
  await page.setViewportSize({ width: 390, height: 844 });
  await frames();
  await frames();
  const resizeDrift = await drift(resizeAnchor);
  assert.equal((await state()).follow, false);
  assert(resizeDrift <= 4, `resize anchor drift ${resizeDrift}`);
  results.push({ resize_stays_detached: true, anchor_drift_px: resizeDrift });
  await latest();
  assert.equal((await state()).follow, true);
  // Viewport growth clamps scrollTop at the bottom; it must preserve existing follow.
  await page.setViewportSize({ width: 1280, height: 1100 });
  await frames();
  await frames();
  assert.equal((await state()).follow, true);
  assert((await state()).distance <= 2);
  results.push({ resize_at_bottom_keeps_follow: true });

  // Real wheel to the top triggers automatic older-page loading; track the anchor
  // exactly before merging the page so the gesture itself is not counted as drift.
  await page.evaluate(() => {
    const v = probe,
      request = v.request;
    v.request = async (...args) => {
      const response = await request(...args);
      if (args[0].direction === "before") {
        window.beforeMerge = v.capture();
        window.paged = true;
      }
      return response;
    };
  });
  await wheel(-10000000);
  await page.waitForFunction(() => window.paged && !probe.pending.size);
  await frames();
  await frames();
  const pageAnchor = await page.evaluate(() => window.beforeMerge);
  assert(pageAnchor, "paging must have a visible anchor");
  const pagingDrift = await drift(pageAnchor);
  assert.equal((await state()).follow, false);
  assert(pagingDrift <= 4, `prepend anchor drift ${pagingDrift}`);
  results.push({
    native_wheel_triggers_paging: true,
    anchor_drift_px: pagingDrift,
  });
  assert.deepEqual(errors, []);
  await page.screenshot({ path: out + "/final.png" });
} catch (error) {
  results.push({
    failure: String(error),
    stack: error.stack,
    state: await state().catch(() => null),
    scrollEnds: await page.evaluate(() => window.scrollEnds).catch(() => null),
  });
  await page.screenshot({ path: out + "/failure.png" }).catch(() => {});
  throw error;
} finally {
  fs.writeFileSync(
    out + "/result.json",
    JSON.stringify({ chrome: browser.version(), results, errors }, null, 2),
  );
  await browser.close();
}
