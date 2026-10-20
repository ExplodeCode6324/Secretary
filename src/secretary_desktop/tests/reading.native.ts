import { browser, $, $$ } from "@wdio/globals";
import assert from "node:assert/strict";
const invoke = (name: string, args: unknown = {}) =>
  browser.executeAsync(
    (n, a, done) => {
      (window as any).__TAURI__.core
        .invoke(n, a)
        .then(done)
        .catch((e: unknown) => done({ error: String(e) }));
    },
    name,
    args,
  ) as Promise<any>;
const snapshot = () => invoke("bridge_profiles");
async function send(text: string) {
  await $("[data-testid=draft]").setValue(text);
  await $("[data-testid=send]").click();
  await browser.waitUntil(
    async () =>
      (await $$("[data-testid=message]").map((m) => m.getText())).some(
        (t) =>
          t.includes("Secretary") && t.includes("已记录") && t.includes(text.trim()),
      ),
    { timeout: 30000 },
  );
}
describe("reading anchor recovery in native WKWebView (offline Core fixture)", () => {
  it("restores an anchor inside the current window without freezing new durable replies", async () => {
    await $("button=连接").click();
    await $("[data-testid=start]").waitForClickable({ timeout: 20000 });
    await $("[data-testid=start]").click();
    await $("[data-testid=draft]").waitForDisplayed({ timeout: 20000 });
    for (let i = 0; i < 3; i++)
      await send(`READING-${i} ` + "Long paragraph for scrolling. ".repeat(80));
    await browser.execute(() => {
      const panel = document.querySelector("main.connected")!;
      const row =
        document.querySelectorAll<HTMLElement>("[data-message-id]")[1];
      panel.scrollTop +=
        row.getBoundingClientRect().top - panel.getBoundingClientRect().top;
      panel.dispatchEvent(new Event("scroll"));
    });
    await browser.waitUntil(
      async () => (await snapshot()).anchor?.startsWith("{"),
      { timeout: 5000 },
    );
    const saved = JSON.parse((await snapshot()).anchor);
    await browser.refresh();
    await $("button=连接").click();
    await $("[data-testid=attach]").waitForClickable({ timeout: 20000 });
    await $("[data-testid=attach]").click();
    await $("[data-testid=draft]").waitForDisplayed({ timeout: 20000 });
    assert.equal(await $("[data-testid=history-banner]").isExisting(), false);
    assert(await $(`[data-message-id="${saved.id}"]`).isExisting());
    await send("READING-AFTER-REOPEN");
    const replies = await $$("[data-testid=message]").map((m) => m.getText());
    assert(
      replies.some(
        (t) => t.includes("Master") && t.includes("READING-AFTER-REOPEN"),
      ),
    );
    assert(
      replies.some(
        (t) =>
          t.includes("Secretary") &&
          t.includes("已记录") &&
          t.includes("READING-AFTER-REOPEN"),
      ),
    );
    await browser.execute(() => {
      const panel = document.querySelector("main.connected")!;
      panel.scrollTop = panel.scrollHeight;
      panel.dispatchEvent(new Event("scroll"));
    });
    await browser.waitUntil(
      async () => (await snapshot()).anchor === "latest",
      { timeout: 5000 },
    );
    await browser.saveScreenshot(
      process.env.SECRETARY_DESKTOP_TEST_DATA + "/reading-recovered.png",
    );
  });
  after(async () => {
    const s = await snapshot();
    if (s.domain)
      await invoke("bridge_stop", {
        expectedDomain: s.domain,
        expectedInstance: s.core.instance_id,
      });
  });
});
