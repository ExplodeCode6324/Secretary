import fs from "node:fs";
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const endpoint = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = process.argv[3];
fs.mkdirSync(out, { recursive: true });
const api = async (route, body) => {
  const response = await fetch(endpoint.url + "/api/" + route, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${endpoint.token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert(response.ok);
  return response.json();
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
const result = { pass: false, errors: [] };
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.on("pageerror", (error) => result.errors.push(error.message));
  await page.goto(endpoint.url + "/#" + endpoint.token);
  await page
    .locator("#message")
    .fill("Synthetic capacity acceptance: preserve the amber condition.");
  await page.locator("#send").click();
  await page.waitForFunction(() =>
    document.querySelector("#context-text").textContent.includes("最近请求"),
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".message.secretary")].some((element) =>
      element.textContent.includes("已处理"),
    ),
  );
  const { client } = await api("client", {});
  const state = await api("state?client=" + client);
  const c = state.context;
  assert.equal(state.state, "IDLE");
  assert.equal(c.capture_kind, "MODEL_REQUEST");
  assert.equal(c.checkpoint.capture_kind, "CHECKPOINT");
  assert.notEqual(c.context_id, c.checkpoint.id);
  assert.notEqual(c.used, c.checkpoint.estimated_tokens);
  assert.equal(c.method, "utf8_bytes_upper_estimate_v1");
  assert.equal(c.next_request_budget, null);
  const label = await page.locator("#context-text").textContent();
  const tooltip = await page.locator("#context-text").getAttribute("title");
  assert(label.includes(c.used.toLocaleString()));
  assert(label.includes(c.usable_input.toLocaleString()));
  assert(tooltip.includes(`输出上限 ${c.effective_output}`));
  assert(tooltip.includes(`工具增长预留 ${c.tool_reserve}`));
  assert(tooltip.includes(`安全余量 ${c.safety_margin}`));
  assert(tooltip.includes("UTF-8 保守估算"));
  assert(tooltip.includes("下一请求发送前重算"));
  assert.deepEqual(result.errors, []);
  await page.screenshot({ path: out + "/desktop.png" });
  await page
    .locator(".context-strip")
    .screenshot({ path: out + "/capacity-strip.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: out + "/mobile.png" });
  Object.assign(result, {
    pass: true,
    label,
    tooltip,
    context: c,
    browser: await browser.version(),
    checkpointIndependent: true,
    nextRequestExplicitlyUnknown: true,
    outputReservesMatchBackend: true,
  });
} finally {
  await browser.close();
  fs.writeFileSync(out + "/browser.json", JSON.stringify(result, null, 2));
}
