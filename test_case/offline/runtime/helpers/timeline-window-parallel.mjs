import fs from "node:fs";
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const e = JSON.parse(fs.readFileSync(process.argv[2], "utf8")),
  out = process.argv[3];
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ channel: "chrome", headless: true }),
  page = await b.newPage({ viewport: { width: 1280, height: 950 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const api = async (path, body) => {
  const r = await fetch(e.url + "/api/" + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${e.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  assert(r.ok);
  return r.json();
};
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
  const { client } = await api("client", {});
  await api("command", { client, line: "/task synthetic window A" });
  await api("command", { client, line: "/task synthetic window B" });
  await page.locator("#message").fill("parallel main");
  await page.locator("#send").click();
  await page.waitForFunction(
    () =>
      probe.cache.items.filter(
        (m) => m.activity?.kind === "task" && m.activity.status === "running",
      ).length >= 2 &&
      probe.cache.items.some(
        (m) =>
          m.activity?.kind === "model" &&
          m.activity.scope === "main" &&
          m.activity.status === "running",
      ),
  );
  const ids = await page.evaluate(() =>
    probe.cache.items
      .filter((m) => m.activity?.kind === "task")
      .map((m) => m.id),
  );
  await page.screenshot({ path: out + "/parallel.png" });
  await page.waitForFunction(
    (ids) =>
      ids.every((id) =>
        probe.cache.items.some((m) => m.id === id && m.activity.ended_at),
      ),
    ids,
  );
  const before = await page.evaluate(
    (ids) =>
      ids.map(
        (id) =>
          document.querySelector(`[data-activity-id="${id}"] summary`)
            ?.textContent,
      ),
    ids,
  );
  // Intentional timer test: stopped durations must remain identical after multiple ticks.
  await new Promise((r) => setTimeout(r, 1600));
  const after = await page.evaluate(
    (ids) =>
      ids.map(
        (id) =>
          document.querySelector(`[data-activity-id="${id}"] summary`)
            ?.textContent,
      ),
    ids,
  );
  assert(before.every(Boolean));
  assert.deepEqual(after, before);
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    out + "/result.json",
    JSON.stringify(
      {
        parallel_tasks: ids.length,
        main_active_together: true,
        terminal_timers_stopped: true,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await b.close();
}
