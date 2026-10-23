import { browser, $ } from "@wdio/globals";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FINAL_READING_MARKER as marker } from "../scripts/final-reading";
const root = process.env.SECRETARY_DESKTOP_TEST_DATA!;
describe("One final bounded real-model reading turn", () => {
  it("retains more than 5000 characters through real durable completion", async () => {
    const grant = JSON.parse(
      fs.readFileSync(path.join(root, "final-review-grant.json"), "utf8"),
    );
    const initial = JSON.parse(
      fs.readFileSync(path.join(root, "calls.json"), "utf8"),
    ).length;
    assert.equal(
      initial,
      grant.previous_total,
      "startup spent no authorized admission",
    );
    await $("button=连接").click();
    await $("[data-testid=attach]").waitForClickable({ timeout: 20000 });
    await $("[data-testid=attach]").click();
    await $("[data-testid=draft]").waitForDisplayed({ timeout: 20000 });
    assert(
      !(await $("button=恢复会话…").isExisting()),
      "fresh isolated Core needs no recovery call",
    );
    await $("[data-testid=draft]").setValue(
      `Isolated reading acceptance ${marker}. Begin your reply with ${marker}. Then write exactly 100 numbered lines of a calm English seaside travel journal, each line containing 18 to 22 English words. Plain prose, no code blocks. Finish line 100 with FE04-READING-END. Do not shorten or summarize. Do not use tools, create tasks, change memory or settings. This is a single direct response.`,
    );
    await $("[data-testid=send]").click();
    let id = "";
    await browser.waitUntil(
      async () => {
        const candidate = await browser.execute((marker) => {
          const row = [
            ...document.querySelectorAll<HTMLElement>("[data-testid=message]"),
          ].find(
            (r) =>
              r.querySelector("header")?.textContent?.includes("助手回复") &&
              r
                .querySelector(".prose:not(.thinking-body)")
                ?.textContent?.includes(marker),
          );
          if (!row) return null;
          return {
            id: row.dataset.messageId!,
            length: row.querySelector(".prose:not(.thinking-body)")!
              .textContent!.length,
            header: row.querySelector("header")!.textContent!,
          };
        }, marker);
        if (!candidate || candidate.length < 5500) return false;
        assert(
          !candidate.header.includes("已记录"),
          "observe the >5000-unit real stream before completion",
        );
        id = candidate.id;
        return true;
      },
      { timeout: 180000, interval: 150 },
    );
    const selected = await browser.execute((id) => {
      const row = document.querySelector<HTMLElement>(
        `[data-message-id="${id}"]`,
      )!;
      const prose = row.querySelector<HTMLElement>(
        ".prose:not(.thinking-body)",
      )!;
      const panel = document.querySelector<HTMLElement>("main.connected")!;
      row.scrollIntoView({ block: "start" });
      const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
      let node: Node | null,
        remaining = 5000;
      while ((node = walker.nextNode())) {
        if ((node.textContent?.length ?? 0) > remaining + 10) break;
        remaining -= node.textContent?.length ?? 0;
      }
      if (!node) throw Error("selection target missing");
      const range = document.createRange();
      range.setStart(node, remaining);
      range.setEnd(node, remaining + 10);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      panel.scrollTop +=
        range.getBoundingClientRect().top -
        panel.getBoundingClientRect().top -
        100;
      const record = {
        floor: prose.textContent!.length,
        min: prose.textContent!.length,
        selection: getSelection()!.toString(),
        sameRow: true,
      };
      (window as any).finalReading = record;
      const observer = new MutationObserver(() => {
        record.min = Math.min(record.min, prose.textContent!.length);
        record.sameRow &&=
          row === document.querySelector(`[data-message-id="${id}"]`);
      });
      observer.observe(row, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      (window as any).finalReadingObserver = observer;
      return record.selection;
    }, id);
    const row = $(`[data-message-id="${id}"]`);
    await browser.waitUntil(
      async () => (await row.$("header").getText()).includes("已记录"),
      { timeout: 180000, interval: 250 },
    );
    assert.equal(
      await browser.execute(() => getSelection()!.toString()),
      selected,
    );
    await browser.execute(() => getSelection()!.removeAllRanges());
    await browser.waitUntil(
      async () => {
        const floor = await browser.execute(
          () => (window as any).finalReading.floor,
        );
        return (
          (await row.$(".prose:not(.thinking-body)").getText()).length >
            floor + 100 &&
          !(await row.$("[data-testid=retained-preview]").isExisting())
        );
      },
      { timeout: 30000 },
    );
    const outcome = await browser.execute(() => {
      (window as any).finalReadingObserver.disconnect();
      return (window as any).finalReading;
    });
    assert(
      outcome.floor >= 5500 && outcome.min >= outcome.floor && outcome.sameRow,
      JSON.stringify(outcome),
    );
    const calls = JSON.parse(
      fs.readFileSync(path.join(root, "calls.json"), "utf8"),
    );
    assert.equal(calls.length - initial, 1);
    assert.equal(calls.at(-1).stopReason, "stop");
    fs.writeFileSync(
      path.join(root, "final-reading-r3.json"),
      JSON.stringify(
        {
          real_model: true,
          one_start: true,
          original_ledger_preserved: true,
          off_tail_completion: true,
          selection_preserved: true,
          ...outcome,
          call_number: calls.at(-1).number,
        },
        null,
        2,
      ),
    );
    await browser.saveScreenshot(path.join(root, "final-reading-r3.png"));
  });
});
