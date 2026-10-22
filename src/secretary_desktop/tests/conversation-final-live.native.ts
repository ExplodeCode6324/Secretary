import { browser, $ } from "@wdio/globals";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = process.env.SECRETARY_DESKTOP_TEST_DATA!;
const marker = "FE04-FINAL-READING";
describe("One final bounded real-model reading turn", () => {
  it("keeps a real streaming reply and reconciles it while off-tail", async () => {
    const initial = JSON.parse(
      fs.readFileSync(path.join(root, "calls.json"), "utf8"),
    ).length;
    await $("button=连接").click();
    await $("[data-testid=attach]").waitForClickable({ timeout: 20000 });
    await $("[data-testid=attach]").click();
    await $("[data-testid=draft]").waitForDisplayed({ timeout: 20000 });
    assert(
      !(await $("button=恢复会话…").isExisting()),
      "no extra recovery call permitted",
    );
    await $("[data-testid=draft]").setValue(
      `隔离最终验收 ${marker}。第一句写 ${marker}，然后写一篇约1200字的中文阅读随笔。直接回复，不调用任何工具，不创建任务，不修改记忆或设置。`,
    );
    await $("[data-testid=send]").click();
    let selected = "",
      id = "";
    const frames = new Set<string>();
    await browser.waitUntil(
      async () => {
        const sample = await browser.execute((marker) => {
          const row = [
            ...document.querySelectorAll<HTMLElement>("[data-testid=message]"),
          ].find(
            (r) =>
              (r.querySelector("header")?.textContent ?? "").includes(
                "助手回复",
              ) &&
              (
                r.querySelector(".prose:not(.thinking-body)")?.textContent ?? ""
              ).includes(marker),
          );
          return row
            ? {
                id: row.dataset.messageId,
                text: row.querySelector(".prose:not(.thinking-body)")!
                  .textContent,
                header: row.querySelector("header")!.textContent,
              }
            : null;
        }, marker);
        if (!sample) return false;
        frames.add(sample.text!);
        id = sample.id!;
        if (!selected && !sample.header!.includes("已记录")) {
          selected = await browser.execute((id) => {
            const row = document.querySelector<HTMLElement>(
              `[data-message-id="${id}"]`,
            )!;
            row.scrollIntoView({ block: "start" });
            const text = row.querySelector(
              ".prose:not(.thinking-body) p",
            )!.firstChild!;
            const r = document.createRange();
            r.setStart(text, 0);
            r.setEnd(text, Math.min(10, text.textContent!.length));
            getSelection()!.removeAllRanges();
            getSelection()!.addRange(r);
            return getSelection()!.toString();
          }, id);
        }
        return sample.header!.includes("已记录");
      },
      { timeout: 180000, interval: 250 },
    );
    assert(selected.length > 0, "a real streaming selection was observed");
    assert.equal(
      await browser.execute(() => getSelection()!.toString()),
      selected,
    );
    await browser.execute(() => getSelection()!.removeAllRanges());
    assert((await $(`[data-message-id="${id}"]`).getText()).includes(marker));
    const calls = JSON.parse(
      fs.readFileSync(path.join(root, "calls.json"), "utf8"),
    );
    assert.equal(calls.length - initial, 1);
    fs.writeFileSync(
      path.join(root, "final-reading.json"),
      JSON.stringify(
        {
          real_model: true,
          one_start: true,
          off_tail_completion: true,
          selection_preserved: true,
          observed_frames: frames.size,
          call_number: calls.at(-1).number,
        },
        null,
        2,
      ),
    );
    await browser.saveScreenshot(path.join(root, "final-reading.png"));
  });
});
