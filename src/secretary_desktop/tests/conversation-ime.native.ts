// Manual system-IME runner: no synthesized composition events, no live Core.
import { browser, $ } from "@wdio/globals";
import fs from "node:fs";
const out = process.env.PHASEUI_EVIDENCE!;
describe("System IME observation", () => {
  it("records actual OS composition while a human or native UI driver exercises the editor", async () => {
    fs.mkdirSync(out, { recursive: true });
    await $("[data-testid=draft]").waitForDisplayed({ timeout: 20000 });
    await browser.execute(() => {
      const log: unknown[] = [];
      (window as any).imeEvidence = log;
      for (const type of [
        "compositionstart",
        "compositionupdate",
        "compositionend",
        "keydown",
        "input",
      ])
        document.addEventListener(
          type,
          (e: any) => {
            if (e.target?.id !== "draft") return;
            if (log.length < 2000)
              log.push({
                type,
                key: e.key,
                data: e.data,
                composing: e.isComposing,
                value: e.target.value,
              });
          },
          true,
        );
    });
    fs.writeFileSync(`${out}/ready`, "ready");
    const start = Date.now();
    while (!fs.existsSync(`${out}/done`) && Date.now() - start < 360000) {
      const result = await browser.execute(() => ({
        events: (window as any).imeEvidence,
        commands: (window as any).conversationTest.commands(),
        draft: (document.querySelector("#draft") as HTMLTextAreaElement).value,
      }));
      fs.writeFileSync(`${out}/observed.json`, JSON.stringify(result, null, 2));
      await browser.pause(1000);
    }
    await browser.saveScreenshot(`${out}/ime.png`);
  });
});
