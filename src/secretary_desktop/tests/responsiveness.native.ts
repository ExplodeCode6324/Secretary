import { browser, $ } from "@wdio/globals";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = process.env.SECRETARY_DESKTOP_TEST_DATA!;
const setup = JSON.parse(
  fs.readFileSync(path.join(root, "setup.json"), "utf8"),
);
describe("responsive native editor during network stall", () => {
  it("keeps input and local enqueue responsive with Core paused", async () => {
    await $("button=连接").click();
    await $("[data-testid=attach]").waitForClickable({ timeout: 20000 });
    await $("[data-testid=attach]").click();
    await $("[data-testid=draft]").waitForDisplayed({ timeout: 20000 });
    await browser.execute(() => {
      (window as any).inputLatency = [];
      document
        .querySelector("[data-testid=draft]")!
        .addEventListener("input", () => {
          const at = performance.now();
          requestAnimationFrame(() => {
            (window as any).inputLatency.push(performance.now() - at);
          });
        });
    });
    process.kill(setup.pid, "SIGSTOP");
    try {
      await new Promise((r) => setTimeout(r, 1200));
      for (let i = 0; i < 25; i++)
        await $("[data-testid=draft]").setValue("合成输入延迟验收 " + i);
      const before = await browser.execute(
        () =>
          document.body.innerText.match(/已保存到本机发送队列：[^\n]+/)?.[0],
      );
      const start = Date.now();
      await $("[data-testid=send]").click();
      await browser.waitUntil(
        async () => {
          const text = await browser.execute(
            () =>
              document.body.innerText.match(
                /已保存到本机发送队列：[^\n]+/,
              )?.[0],
          );
          return !!text && text !== before;
        },
        { timeout: 3000, interval: 25 },
      );
      const queued = Date.now() - start;
      assert(queued <= 250, `queued feedback ${queued}ms`);
      const latencies = await browser.execute(
        () => (window as any).inputLatency as number[],
      );
      latencies.sort((a, b) => a - b);
      const p95 = latencies[Math.floor(latencies.length * 0.95)];
      assert(p95 <= 50, `input p95 ${p95}ms`);
      fs.writeFileSync(
        path.join(root, "responsiveness-evidence.json"),
        JSON.stringify({
          core: "SIGSTOP",
          input_samples: latencies.length,
          input_p95_ms: p95,
          queued_feedback_ms: queued,
        }),
      );
    } finally {
      process.kill(setup.pid, "SIGCONT");
    }
  });
});
