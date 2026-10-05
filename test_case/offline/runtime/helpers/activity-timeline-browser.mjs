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
    const before = await page.locator(".message.secretary").count();
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
      (n) => document.querySelectorAll(".message.secretary").length > n,
      before,
    );
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.timeline-activity[data-status="running"]')
          .length === 0,
    );
    results.push({ streaming, thinking, inlineActivity: true });
  }
  await page.locator("#message").fill("query-memory");
  await page.locator("#send").click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".timeline-activity")].some((x) =>
      x.textContent.includes("已读取工作记忆"),
    ),
  );
  const toolIDs = await page
    .locator('.timeline-activity[data-activity-id^="tool:"]')
    .evaluateAll((rows) => rows.map((r) => r.dataset.activityId));
  assert.equal(toolIDs.length, 1);
  const toolText = await page
    .locator('.timeline-activity[data-activity-id^="tool:"] summary')
    .textContent();
  assert(toolText.includes("耗时未知"));
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.timeline-activity[data-activity-id^="tool:"]')
        .length === 1,
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
    () => document.querySelector("#activity").dataset.connected === "false",
  );
  await context.setOffline(false);
  await page.waitForFunction(
    () => document.querySelector("#activity").dataset.connected === "true",
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.timeline-activity[data-status="running"]')
        .length === 0,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#timeline").evaluate((n) => {
    n.scrollTop = n.scrollHeight;
  });
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
