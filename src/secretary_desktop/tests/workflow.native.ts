import { browser, $, $$ } from "@wdio/globals";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = process.env.SECRETARY_DESKTOP_TEST_DATA!;
const read = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const setup = read("setup.json");
const write = (name: string, value: unknown) =>
  fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2));
const state = () => read("state.json");
async function send(text: string) {
  await $("[data-testid=draft]").setValue(text);
  await $("[data-testid=send]").click();
}
async function attach() {
  await $("button=连接").click();
    await $("[data-testid=attach]").waitForClickable({ timeout: 20000 });
  await $("[data-testid=attach]").click();
  await $("[data-testid=draft]").waitForDisplayed({ timeout: 20000 });
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
describe("FE-02 real model / native WKWebView", () => {
  it("shows real incremental output and durable final messages", async () => {
    await attach();
    write("scenario.json", { name: "conversation" });
    const previous = new Set(
      await $$("[data-testid=message]").map((m) =>
        m.getAttribute("data-message-id"),
      ),
    );
    await send(
      "这是隔离验收。请用中文写一段约600字的平静海边散步描写。只需要普通对话，不创建任务，不调用工具。第一句包含 FE02-LIVE。",
    );
    const seen = new Set<string>();
    let durable = false;
    const start = Date.now();
    while (Date.now() - start < 180000) {
      const messages = await $$("[data-testid=message]");
      for (const m of messages) {
        if (previous.has(await m.getAttribute("data-message-id"))) continue;
        const text = await m.getText();
        if (text.includes("Secretary") && text.includes("FE02-LIVE")) {
          seen.add(text);
          if (text.includes("已记录")) durable = true;
        }
      }
      if (durable) break;
      await pause(250);
    }
    write("conversation-evidence.json", {
      durable,
      distinct_frames: seen.size,
      elapsed_ms: Date.now() - start,
    });
    assert(durable, "real assistant final must become durable");
    assert(seen.size > 1, "incremental native frames expected");
    await browser.saveScreenshot(path.join(root, "conversation.png"));
  });
  it("creates an allowed Scope task and renders its structured result", async () => {
    write("scenario.json", { name: "allow" });
    await send(
      `请立即创建并执行一个任务：在现有 Scope FE02 scratch（ID ${setup.scope_id}）内创建 fe02-allowed.txt，精确内容为 FE02 real model allowed write succeeded 后接换行。以实际读取文件校验内容作为完成条件，并将该文件登记为 artifact。必须仅使用 write/read 工具，禁止 shell/exec/run 命令，不需目录探索或执行程序。不要在对话中假装执行。无需新建Scope。`,
    );
    await browser.waitUntil(
      async () =>
        state().results.some((r: any) => r.outcome === "SUCCEEDED") ||
        state().authorizations.some((a: any) => a.state === "PENDING"),
      {
        timeout: 240000,
        interval: 1000,
        timeoutMsg: "real task did not finish or request approval",
      },
    );
    write("allow-state.json", state());
    assert(
      state().results.some((r: any) => r.outcome === "SUCCEEDED"),
      "allowed write must succeed",
    );
    assert.equal(
      fs.readFileSync(path.join(setup.scratch, "fe02-allowed.txt"), "utf8"),
      "FE02 real model allowed write succeeded\n",
    );
    await $("[data-page=tasks]").click();
    await $("[data-testid=task]").waitForClickable({ timeout: 15000 });
    await $("[data-testid=task]").click();
    await $("[data-testid=result]").waitForDisplayed({ timeout: 20000 });
    await $("[data-testid=artifact]").waitForDisplayed({ timeout: 20000 });
    await browser.saveScreenshot(path.join(root, "result.png"));
  });
});
