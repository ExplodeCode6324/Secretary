import { browser, $, $$ } from "@wdio/globals";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const root = process.env.SECRETARY_DESKTOP_TEST_DATA!;
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, "fixture.json"), "utf8"),
);
const invoke = (name: string, args: unknown = {}) =>
  browser.executeAsync(
    (n, a, done) => {
      (window as any).__TAURI__.core
        .invoke(n, a)
        .then((v: unknown) => done({ value: v }))
        .catch((e: unknown) => done({ failure: String(e) }));
    },
    name,
    args,
  ) as Promise<any>;
async function locate(id: string) {
  await $("label=定位 ID").$("input").setValue(id);
  await $("button=定位").click();
  await browser.waitUntil(
    async () => await $(`[data-message-id="${id}"]`).isExisting(),
    { timeout: 20000 },
  );
}
describe("Issue63 native conversation synthetic fixture", () => {
  it("defaults thinking ON but collapsed; pages, long content, selection, clipboard and draft stay coherent", async () => {
    await $("button=连接").click();
    await $("[data-testid=start]").waitForClickable({ timeout: 20000 });
    await $("[data-testid=start]").click();
    await $("[data-testid=draft]").waitForDisplayed({ timeout: 20000 });
    await $("button=思考：开").waitForExist({ timeout: 20000 });
    await browser.waitUntil(
      async () => (await $$("[data-testid=message]").length) > 0,
      { timeout: 20000 },
    );
    assert.equal(
      await browser.execute(() =>
        [
          ...document.querySelectorAll<HTMLDetailsElement>(
            "[data-testid=thinking]",
          ),
        ].some((d) => d.open),
      ),
      false,
    );
    await locate(fixture.ids[980].id);
    const selector = `[data-message-id="${fixture.ids[980].id}"]`;
    const thought = await $(selector).$("[data-testid=thinking] summary");
    await thought.click();
    assert((await $(selector).getText()).includes("人工思考摘要"));
    await thought.click();
    for (let i = 0; i < 40; i++) {
      const more = await $(selector).$("button=继续读取内容");
      if (!(await more.isExisting())) break;
      await more.click();
      await browser.waitUntil(
        async () =>
          !(await $(selector).$("button=继续读取内容").isExisting()) ||
          (await $(selector).$("button=继续读取内容").isEnabled()),
        { timeout: 10000 },
      );
    }
    assert(await $(selector).$("button=复制完整正文").isExisting());
    await $(selector).$("button=复制完整正文").click();
    await browser.waitUntil(
      async () => (await $(selector).getText()).includes("已复制"),
      { timeout: 10000 },
    );
    assert.equal(
      execFileSync("/usr/bin/pbpaste", [], {
        encoding: "utf8",
        env: { ...process.env, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" },
      }),
      fixture.ids[980].text,
    );
    const copy = await invoke("bridge_copy_text", { text: "中文👩‍💻é𠮷" });
    assert(!copy.failure);
    assert.equal(
      execFileSync("/usr/bin/pbpaste", [], {
        encoding: "utf8",
        env: { ...process.env, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" },
      }),
      "中文👩‍💻é𠮷",
    );
    const blocked = await invoke("bridge_open_url", {
      url: "file:///tmp/no-open",
    });
    assert.equal(blocked.failure, "INVALID_URL");
    await $("button=思考：开").click();
    await $("button=思考：关").waitForExist();
    assert.equal(await $$("[data-testid=thinking]").length, 0);
    await $("[data-testid=draft]").setValue("未发送草稿 中文👩‍💻");
    await browser.waitUntil(
      async () =>
        JSON.stringify((await invoke("bridge_profiles")).value?.draft).includes(
          "未发送草稿",
        ),
      { timeout: 10000 },
    );
    await $("[data-page=tasks]").click();
    await $("[data-page=conversation]").click();
    assert.equal(
      await $("[data-testid=draft]").getValue(),
      "未发送草稿 中文👩‍💻",
    );
    await $("button=较早消息").click();
    await browser.waitUntil(
      async () => (await $$("[data-row-id]").length) > 50,
      { timeout: 20000 },
    );
    assert((await $$("[data-row-id]").length) <= 150);
    await $("button=转到最新消息").click();
    await browser.waitUntil(
      async () => (await $$("[data-row-id]").length) <= 58,
      { timeout: 20000 },
    );
    await browser.saveScreenshot(path.join(root, "conversation.png"));
    fs.writeFileSync(
      path.join(root, "native-result.json"),
      JSON.stringify({
        synthetic: true,
        thinking_default_on: true,
        collapsed: true,
        unicode_clipboard: true,
        long_eof_copy: true,
        draft_navigation: true,
        paging: true,
      }),
    );
    const snap = (await invoke("bridge_profiles")).value;
    await invoke("bridge_stop", {
      expectedDomain: snap.domain,
      expectedInstance: snap.core.instance_id,
    });
  });
});
