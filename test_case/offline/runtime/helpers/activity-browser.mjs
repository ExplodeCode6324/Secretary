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
  errors = [];
const call = async (route, body) => {
  const r = await fetch(endpoint.url + "/api/" + route, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${endpoint.token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw Error(await r.text());
  return r.json();
};
const { client } = await call("client", {});
try {
  const context = await browser.newContext({
      viewport: { width: 1280, height: 950 },
    }),
    page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(endpoint.url + "/#" + endpoint.token);
  await page.waitForFunction(
    () => document.querySelector("#activity").dataset.connected === "true",
  );
  for (const [streaming, thinking] of [
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ]) {
    await page.locator("#display-streaming").setChecked(streaming);
    await page.locator("#display-thinking").setChecked(thinking);
    const before = await page.locator(".message.secretary").count();
    await page.locator("#message").fill("synthetic browser activity");
    const activityStarted = Date.now();
    await page.locator("#send").click();
    await page.waitForFunction(() =>
      [
        ...document.querySelectorAll('.activity-row[data-status="running"]'),
      ].some((x) => x.textContent.includes("正在思考")),
    );
    const visibleMs = Date.now() - activityStarted;
    assert(visibleMs < 1000, `activity appeared after ${visibleMs}ms`);
    if (!streaming)
      assert.equal(await page.locator(".message.secretary").count(), before);
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.activity-row[data-status="running"]')
          .length === 0,
    );
    await page.waitForFunction(
      (n) => document.querySelectorAll(".message.secretary").length > n,
      before,
    );
    results.push({ streaming, thinking, activity: true, visibleMs });
  }
  await call("command", { client, line: "/task synthetic A" });
  await call("command", { client, line: "/task synthetic B" });
  await page.locator("#message").fill("parallel synthetic main");
  await page.locator("#send").click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.activity-row[data-status="running"]')
        .length >= 3,
  );
  await page.screenshot({
    path: out + "/parallel-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.activity-row[data-status="running"]')
        .length >= 2,
  );
  await page.locator("#message").fill("未发送文字 Master");
  await page.waitForTimeout(1200);
  assert.equal(
    await page.locator("#message").inputValue(),
    "未发送文字 Master",
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.activity-row[data-status="running"]')
        .length === 0,
  );
  results.push({ parallel: true, reload: true, inputPreserved: true });
  let settings = await call("settings?client=" + client);
  await call("settings/draft", {
    client,
    payload: {
      ...settings.draft.payload,
      instructions: {
        content: "请使用中文回答。",
        expected_revision: settings.effective_instructions.revision,
      },
    },
    expected_revision: settings.draft.revision,
  });
  settings = await call("settings?client=" + client);
  await call("settings/apply", {
    client,
    expected_revision: settings.draft.revision,
    request_id: crypto.randomUUID(),
  });
  await call("message", {
    client,
    text: "queued synthetic",
    request_id: crypto.randomUUID(),
  });
  await page.waitForFunction(() =>
    document.querySelector("#activity").textContent.includes("待处理消息 1 条"),
  );
  await page.waitForFunction(() =>
    document.querySelector(".activity-current").textContent.includes("段"),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: out + "/settings-mobile.png", fullPage: true });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  const textarea = await page.locator("#message").boundingBox();
  assert(textarea && textarea.y >= 0 && textarea.y + textarea.height <= 844);
  await page.locator("#activity details summary").click();
  await page.waitForTimeout(500);
  assert(await page.locator("#activity details").evaluate((n) => n.open));
  await context.setOffline(true);
  await page.waitForFunction(
    () => document.querySelector("#activity").dataset.connected === "false",
    { timeout: 17000 },
  );
  await context.setOffline(false);
  await page.waitForFunction(
    () => document.querySelector("#activity").dataset.connected === "true",
  );
  await page.waitForFunction(
    () =>
      !document
        .querySelector(".activity-queue")
        .textContent.includes("待处理消息 1 条"),
    { timeout: 30000 },
  );
  results.push({
    settingsChunks: true,
    queue: true,
    narrowScreen: true,
    reconnect: true,
  });
  await call("message", {
    client,
    text: "query-memory",
    request_id: crypto.randomUUID(),
  });
  await page.waitForFunction(() =>
    document
      .querySelector("#activity details")
      .textContent.includes("正在读取工作记忆"),
  );
  results.push({ shortToolHistory: true });
  const safety = await page.evaluate(async () => {
    const { ActivityView } = await import("/activity.js");
    const root = document.createElement("div");
    document.body.append(root);
    const view = new ActivityView(root, () => {});
    const base = {
      server_instance_id: "test-one",
      activity_revision: 2,
      store_revision: 0,
      observed_at: new Date().toISOString(),
      activities: [],
      recent: [],
      queue: { accepted: 0, claimed: 0, feedback: 0, blocked: false },
      background_counts: { running: 0, waiting: 0 },
      total: 0,
      truncated: false,
    };
    view.accept(base);
    view.accept({ ...base, activity_revision: 1 });
    const olderIgnored = view.snapshot.activity_revision === 2;
    view.accept({
      ...base,
      server_instance_id: "test-two",
      activity_revision: 0,
    });
    view.accept({ ...base, activity_revision: 99 });
    const retiredIgnored = view.snapshot.server_instance_id === "test-two";
    view.accept({
      ...base,
      server_instance_id: "test-two",
      activity_revision: 1,
      activities: [
        {
          id: "unsafe",
          parent_id: null,
          scope: "main",
          kind: "tool",
          phase: '<img src=x onerror="window.injected=true">',
          status: "running",
          version: 1,
          started_at: base.observed_at,
          last_progress_at: base.observed_at,
          ended_at: null,
          actions: [],
        },
      ],
    });
    const safe =
      !root.querySelector("img") &&
      !window.injected &&
      root.textContent.includes("<img");
    view.close();
    root.remove();
    return { olderIgnored, retiredIgnored, safe };
  });
  assert.deepEqual(safety, {
    olderIgnored: true,
    retiredIgnored: true,
    safe: true,
  });
  results.push(safety);
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    out + "/browser.json",
    JSON.stringify({ pass: true, results, errors }, null, 2),
  );
} catch (e) {
  fs.writeFileSync(
    out + "/browser-failure-" + Date.now() + ".json",
    JSON.stringify({ pass: false, results, errors, error: String(e) }, null, 2),
  );
  throw e;
} finally {
  await browser.close();
}
