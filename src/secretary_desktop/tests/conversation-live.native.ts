import { browser, $, $$ } from "@wdio/globals";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = process.env.SECRETARY_DESKTOP_TEST_DATA!;
const read = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const setup = read("setup.json");
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function send(text: string) {
  await $("[data-testid=draft]").setValue(text);
  await $("[data-testid=send]").click();
}
async function final(marker: string, timeout = 180000) {
  await browser.waitUntil(
    async () =>
      await browser.execute(
        (token) =>
          [...document.querySelectorAll("[data-testid=message]")].some(
            (r) =>
              (r.querySelector("header")?.textContent ?? "").includes(
                "助手回复",
              ) &&
              (r.textContent ?? "").includes("已记录") &&
              (r.textContent ?? "").includes(token),
          ),
        marker,
      ),
    { timeout, interval: 300 },
  );
}
const result: Record<string, unknown> = {
  real_model: true,
  injected_faults: [],
  turns: [],
};
describe("Issue63 real model in native WKWebView", () => {
  it("multi-round text, read-only tool calls, streaming disconnect and injected provider failure/recovery", async () => {
    await $("button=连接").click();
    await $("[data-testid=attach]").waitForClickable({ timeout: 20000 });
    await $("[data-testid=attach]").click();
    await $("[data-testid=draft]").waitForDisplayed({ timeout: 20000 });
    if (await $("button=恢复会话…").isExisting()) {
      await $("button=恢复会话…").click();
      await $("button=确认恢复会话").click();
      await final("FE04-LIVE-RECOVERED");
    }
    await send(
      "隔离验收 FE04-LIVE-ONE-R2。请直接写约900字的中文海边散步随笔，第一句包含 FE04-LIVE-ONE-R2。不要创建任务或调用工具。这是第一轮普通对话。",
    );
    const frames = new Set<string>();
    let interrupted = false;
    const start = Date.now();
    while (Date.now() - start < 180000) {
      const rows = await browser.execute(() =>
        [...document.querySelectorAll("[data-testid=message]")]
          .filter((r) =>
            (r.querySelector("header")?.textContent ?? "").includes("助手回复"),
          )
          .map((r) => ({
            text: r.querySelector(".prose")?.textContent ?? "",
            header: r.querySelector("header")?.textContent ?? "",
          })),
      );
      for (const row of rows) {
        if (row.text.includes("FE04-LIVE-ONE-R2")) {
          frames.add(row.text);
          if (!interrupted && !row.header.includes("已记录")) {
            process.kill(setup.pid, "SIGUSR1");
            interrupted = true;
          }
        }
      }
      if (
        rows.some(
          (r) =>
            r.header.includes("已记录") && r.text.includes("FE04-LIVE-ONE-R2"),
        )
      )
        break;
      await delay(250);
    }
    await final("FE04-LIVE-ONE-R2");
    assert(frames.size > 1);
    assert(interrupted);
    result.streaming_frames = frames.size;
    result.sse_interrupted = true;
    fs.writeFileSync(
      path.join(root, "native-progress-r2.json"),
      JSON.stringify(result),
    );
    await send(
      "第二轮 FE04-LIVE-TWO-R2：请实际调用一次只读 memory_read 工具，source=consciousness，读取当前工作记忆，然后只用两三句话说明读取结果，回复包含 FE04-LIVE-TWO-R2。不要写文件，不要创建任务，不要修改记忆或设置。",
    );
    await final("FE04-LIVE-TWO-R2");
    const tools = await browser.execute(() =>
      [...document.querySelectorAll<HTMLDetailsElement>(".activity details")]
        .filter((d) =>
          (d.querySelector("summary")?.textContent ?? "").includes("工具调用"),
        )
        .map((d) => ({
          open: d.open,
          summary: d.querySelector("summary")?.textContent,
        })),
    );
    assert(tools.length > 0, "real read-only tool activity required");
    assert(tools.every((t) => !t.open));
    result.tool_summaries = tools;
    fs.writeFileSync(path.join(root, "scenario.json"), JSON.stringify({name:"recovery"}));
    await send(
      "第三轮 FE04-LIVE-INTERRUPT-R2：请从第一句 FE04-LIVE-INTERRUPT-R2 开始，写一篇很长的中文短文，至少1500字，主题是阅读与记忆。不调用工具，不创建任务。",
    );
    await browser.waitUntil(
      async () =>
        await browser.execute(() =>
          [...document.querySelectorAll("[data-testid=message]")].some(
            (r) =>
              (r.querySelector("header")?.textContent ?? "").includes(
                "正在生成",
              ) && (r.textContent ?? "").includes("FE04-LIVE-INTERRUPT-R2"),
          ),
        ),
      { timeout: 180000, interval: 200 },
    );
    process.kill(setup.pid, "SIGUSR2");
    await browser.waitUntil(
      async () => fs.existsSync(path.join(root, "provider-interruption.json")),
      { timeout: 5000 },
    );
    assert(read("provider-interruption.json").active);
    await $("button=恢复会话…").waitForExist({ timeout: 20000 });
    await $("button=恢复会话…").click();
    await $("button=确认恢复会话").click();
    await delay(3000);
    await send(
      "第四轮恢复核对：请直接回复 FE04-LIVE-RECOVERED-R2，表示你已收到这一条新的普通对话。不调用工具，不创建任务。",
    );
    await final("FE04-LIVE-RECOVERED-R2");
    result.provider_abort = read("provider-interruption.json");
    result.recovered = true;
    result.calls = read("calls.json").map((c: any) => ({
      number: c.number,
      role: c.role,
      provider: c.provider,
      model: c.model,
      stopReason: c.stopReason,
      error: c.error,
      elapsed_ms: c.elapsed_ms,
    }));
    await browser.saveScreenshot(path.join(root, "conversation-live.png"));
    fs.writeFileSync(
      path.join(root, "native-result.json"),
      JSON.stringify(result, null, 2),
    );
  });
});
