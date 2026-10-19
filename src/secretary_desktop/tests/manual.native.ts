import { browser } from "@wdio/globals";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
const run = resolve(
  "../../.demo-data/issue58/runs",
  new Date().toISOString().replaceAll(":", "-") + "-manual-native",
);
describe("native manual evidence recorder", () => {
  it("records actual OS input without synthesizing composition", async () => {
    mkdirSync(run, { recursive: true });
    writeFileSync(resolve("../../.demo-data/issue58/manual-active.txt"), run);
    await browser.waitUntil(
      async () => browser.execute(() => !!(window as any).study),
      { timeout: 30000 },
    );
    await browser.execute(() => {
      (window as any).manualEvents = [];
      for (const type of [
        "compositionstart",
        "compositionend",
        "pointerdown",
        "pointerup",
        "click",
        "keydown",
        "blur",
      ]) {
        document.addEventListener(
          type,
          (e) => {
            const list = (window as any).manualEvents;
            list.push({
              type: e.type,
              eventTime: e.timeStamp,
              observedAt: performance.now(),
              trusted: e.isTrusted,
              detail: (e as UIEvent).detail,
              key: (e as KeyboardEvent).key,
              target: (e.target as HTMLElement)?.className,
            });
            if (list.length > 200) list.shift();
          },
          true,
        );
      }
    });
    const start = Date.now();
    let previous = "";
    let sequence = 0;
    while (!existsSync(run + "/done") && Date.now() - start < 600000) {
      const state = await browser.execute(() => ({
        ...(window as any).study.snapshot(),
        observedEvents: (window as any).manualEvents,
      }));
      const encoded = JSON.stringify(state);
      if (encoded !== previous) {
        writeFileSync(
          run + `/snapshot-${String(sequence++).padStart(5, "0")}.json`,
          JSON.stringify(state, null, 2),
        );
        previous = encoded;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await browser.saveScreenshot(run + "/last-window.png");
    writeFileSync(
      run + "/index.json",
      JSON.stringify(
        {
          status: "RECORDED_NOT_AUTO_PASS",
          method: "Cua OS keys/mouse; embedded driver observes only",
          snapshots: sequence,
          elapsed_ms: Date.now() - start,
        },
        null,
        2,
      ),
    );
  }).timeout(650000);
});
