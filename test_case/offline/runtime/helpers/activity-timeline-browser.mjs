import fs from "node:fs";
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const endpoint = JSON.parse(fs.readFileSync(process.argv[2], "utf8")),
  out = process.argv[3];
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [],
  results = [];
const call = async (route, body) => {
  const response = await fetch(endpoint.url + "/api/" + route, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${endpoint.token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert(response.ok, await response.clone().text());
  return response.json();
};
try {
  const context = await browser.newContext({
      viewport: { width: 1280, height: 950 },
    }),
    page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const { client } = await call("client", {});
  await page.goto(endpoint.url + "/#" + endpoint.token);
  await page.waitForFunction(
    () => document.querySelectorAll("#messages .timeline-activity").length > 0,
  );
  const initialActivities = await page
    .locator("#messages .timeline-activity")
    .count();
  if (await page.locator(".activity-load-more").isVisible()) {
    await page.locator(".activity-load-more").click();
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll("#messages .timeline-activity").length >
        count,
      initialActivities,
    );
    const ids = await page
      .locator("#messages .timeline-activity")
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.activityId));
    assert.equal(ids.length, new Set(ids).size);
    results.push({
      historyPagination: true,
      initialActivities,
      loadedActivities: ids.length,
    });
  }
  for (const [streaming, thinking] of [
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ]) {
    await page.locator("#display-streaming").setChecked(streaming);
    await page.locator("#display-thinking").setChecked(thinking);
    const before = await page
      .locator(".message.secretary")
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.messageId));
    await page.locator("#message").fill("synthetic timeline probe");
    await page.locator("#send").click();
    await page.waitForFunction(() =>
      [
        ...document.querySelectorAll(
          '.timeline-activity[data-status="running"]',
        ),
      ].some((x) => x.textContent.includes("正在思考")),
    );
    await page.waitForFunction(
      (ids) =>
        [...document.querySelectorAll(".message.secretary")].some(
          (node) =>
            !ids.includes(node.dataset.messageId) &&
            node.textContent.includes("逐段输出的正文。"),
        ),
      before,
    );
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.timeline-activity[data-status="running"]')
          .length === 0,
    );
    results.push({ streaming, thinking, inlineActivity: true });
  }
  const priorToolIDs = new Set(
    await page
      .locator('.timeline-activity[data-activity-id^="tool:"]')
      .evaluateAll((rows) => rows.map((row) => row.dataset.activityId)),
  );
  await page.locator("#message").fill("query-memory");
  await page.locator("#send").click();
  await page.waitForFunction(
    (ids) =>
      [
        ...document.querySelectorAll(
          '.timeline-activity[data-activity-id^="tool:"]',
        ),
      ].some(
        (row) =>
          !ids.includes(row.dataset.activityId) &&
          row.textContent.includes("已读取工作记忆"),
      ),
    [...priorToolIDs],
  );
  const toolIDs = await page
    .locator('.timeline-activity[data-activity-id^="tool:"]')
    .evaluateAll((rows) => rows.map((r) => r.dataset.activityId));
  assert.equal(toolIDs.length, new Set(toolIDs).size);
  const newToolIDs = toolIDs.filter((id) => !priorToolIDs.has(id));
  assert.equal(
    newToolIDs.length,
    1,
    "one new activity per query, including a reused synthetic fixture",
  );
  const toolText = await page
    .locator(`[data-activity-id="${newToolIDs[0]}"] summary`)
    .textContent();
  assert(toolText.includes("耗时未知"));
  await page.reload();
  await page.waitForFunction(
    (ids) =>
      ids.every(
        (id) =>
          document.querySelectorAll(`[data-activity-id="${id}"]`).length === 1,
      ),
    toolIDs,
  );
  assert.deepEqual(
    await page
      .locator('.timeline-activity[data-activity-id^="tool:"]')
      .evaluateAll((rows) => rows.map((r) => r.dataset.activityId)),
    toolIDs,
  );
  await call("command", { client, line: "/task synthetic timeline A" });
  await call("command", { client, line: "/task synthetic timeline B" });
  await page.locator("#message").fill("parallel main");
  await page.locator("#send").click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.timeline-activity[data-status="running"]')
        .length >= 3,
  );
  await page.screenshot({ path: out + "/parallel.png", fullPage: true });
  await page.locator("#message").fill("未发送草稿 保持光标");
  await page.locator("#message").evaluate((n) => n.setSelectionRange(3, 3));
  await page.evaluate(() => {
    document.querySelector("#timeline").scrollTop = 0;
  });
  const scroll = await page.locator("#timeline").evaluate((n) => n.scrollTop);
  await page.waitForTimeout(1300);
  assert(
    Math.abs(
      (await page.locator("#timeline").evaluate((n) => n.scrollTop)) - scroll,
    ) < 3,
  );
  assert.equal(
    await page.locator("#message").inputValue(),
    "未发送草稿 保持光标",
  );
  assert.equal(
    await page.locator("#message").evaluate((n) => n.selectionStart),
    3,
  );
  await context.setOffline(true);
  await page.waitForFunction(
    () =>
      !navigator.onLine &&
      document
        .querySelector("#activity .activity-connection")
        ?.textContent.includes("连接中断"),
  );
  await context.setOffline(false);
  await page.waitForFunction(
    () =>
      navigator.onLine &&
      document.querySelector("#connection")?.textContent.includes("已同步") &&
      document.querySelector("#activity .activity-connection")?.textContent ===
        "",
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.timeline-activity[data-status="running"]')
        .length === 0,
  );
  // Offscreen active records are deliberately absent from the bounded DOM.
  // Verify authoritative completion and its UI projection, not mounted-card count.
  const idleDeadline = Date.now() + 45000;
  let idleSnapshot;
  do {
    idleSnapshot = await call("activity?client=" + encodeURIComponent(client));
    if (
      !idleSnapshot.activities.length &&
      !idleSnapshot.queue.accepted &&
      !idleSnapshot.queue.claimed
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < idleDeadline);
  assert.equal(
    idleSnapshot.activities.length,
    0,
    "all three concurrent activities must finish",
  );
  assert.equal(idleSnapshot.queue.accepted, 0);
  assert.equal(idleSnapshot.queue.claimed, 0);
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#activity .activity-locators button")
        .length === 0 &&
      document
        .querySelector("#activity .activity-queue")
        ?.textContent.trim() === "",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.locator(".timeline-latest").isVisible())
    await page.locator(".timeline-latest").click();
  await page.waitForFunction(
    () => document.querySelector(".timeline-latest")?.hidden,
  );
  await page.screenshot({ path: out + "/mobile.png", fullPage: true });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.equal(await page.locator("#activity .activity-row").count(), 0);
  assert.deepEqual(errors, []);
  const defensive = await page.evaluate(async () => {
    const { ActivityView } = await import("/activity.js");
    const root = document.createElement("section");
    document.body.append(root);
    const v = new ActivityView(root, () => {});
    const at = new Date().toISOString();
    const activity = {
      id: "synthetic-safe",
      parent_id: null,
      session_id: "s",
      execution_id: null,
      scope: "main",
      kind: "tool",
      phase: '<img src=x onerror="globalThis.compromised=true">',
      status: "succeeded",
      version: 1,
      started_at: at,
      ended_at: at,
      last_progress_at: at,
      actions: [],
    };
    const base = {
      server_instance_id: "old",
      activity_revision: 2,
      store_revision: 2,
      observed_at: at,
      activities: [],
      recent: [activity],
      queue: {},
      total: 0,
    };
    v.accept(base);
    for (const n of v.nodes()) root.append(n.node);
    const literal = root.textContent.includes("<img");
    const noImage = !root.querySelector("img");
    v.accept({ ...base, activity_revision: 1, recent: [] });
    const oldIgnored = v.entries().length === 1;
    v.accept({
      ...base,
      server_instance_id: "new",
      activity_revision: 0,
      store_revision: 0,
      recent: [],
    });
    v.accept(base);
    const retiredIgnored = v.snapshot.server_instance_id === "new";
    v.close();
    root.remove();
    return { literal, noImage, oldIgnored, retiredIgnored };
  });
  assert(Object.values(defensive).every(Boolean));
  fs.writeFileSync(
    out + "/result.json",
    JSON.stringify(
      {
        pass: true,
        combinations: results,
        reloadToolIDs: toolIDs,
        parallel: 3,
        scrollPreserved: true,
        draftPreserved: true,
        mobile: 390,
        offlineReconnect: true,
        finalAuthoritativeActive: idleSnapshot.activities.length,
        finalQueue: idleSnapshot.queue,
        errors,
        defensive,
      },
      null,
      2,
    ),
  );
} catch (e) {
  fs.writeFileSync(
    out + "/failure.json",
    JSON.stringify({ error: e.stack, errors, results }, null, 2),
  );
  throw e;
} finally {
  await browser.close();
}
