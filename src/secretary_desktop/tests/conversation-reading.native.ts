import { browser, $, $$ } from "@wdio/globals";
import assert from "node:assert/strict";
import fs from "node:fs";
const out = process.env.PHASEUI_EVIDENCE!;
const state = () =>
  browser.execute(() => {
    const panel = document.querySelector<HTMLElement>("main.connected")!;
    const anchor = [
      ...panel.querySelectorAll<HTMLElement>("[data-row-id]"),
    ].find(
      (r) =>
        r.getBoundingClientRect().bottom > panel.getBoundingClientRect().top,
    );
    return {
      anchor: anchor?.dataset.rowId,
      offset: anchor
        ? anchor.getBoundingClientRect().top - panel.getBoundingClientRect().top
        : 0,
      top: panel.scrollTop,
      height: panel.scrollHeight,
      view: panel.clientHeight,
      selection: getSelection()?.toString() ?? "",
      first: panel.querySelector("[data-row-id]")?.getAttribute("data-row-id"),
    };
  });
describe("Issue63 asynchronous reading", () => {
  it("keeps user scroll and selection during delayed snapshots and new durable rows", async () => {
    fs.mkdirSync(out, { recursive: true });
    await $("[data-testid=message]").waitForExist({ timeout: 20000 });
    if (await $("button=思考：关").isExisting()) await $("button=思考：关").click();
    await $("button=转到最新消息").click();
    await browser.execute(() =>
      (window as any).conversationTest.delaySnapshot(1200),
    );
    await browser.waitUntil(
      async () =>
        await browser.execute(() =>
          (window as any).conversationTest.pendingSnapshot(),
        ),
      { timeout: 5000 },
    );
    await browser.execute(() => {
      document.querySelector<HTMLElement>("main.connected")!.scrollTop = 120;
      (window as any).conversationTest.appendRows(80);
    });
    const before = await state();
    await $("[data-testid=new-messages]").waitForExist({ timeout: 6000 });
    const after = await state();
    assert.equal(after.first, before.first);
    assert.equal(after.anchor, before.anchor);
    assert(
      Math.abs(after.offset - before.offset) <= 2,
      JSON.stringify({ before, after }),
    );
    assert(!(await $("[role=alert]").isExisting()));
    // A second asynchronous refresh must not use a position captured before the wait.
    await browser.execute(() =>
      (window as any).conversationTest.delaySnapshot(1200),
    );
    await browser.waitUntil(
      async () =>
        await browser.execute(() =>
          (window as any).conversationTest.pendingSnapshot(),
        ),
      { timeout: 5000 },
    );
    await browser.execute(
      () =>
        (document.querySelector<HTMLElement>("main.connected")!.scrollTop =
          240),
    );
    await browser.waitUntil(
      async () =>
        !(await browser.execute(() =>
          (window as any).conversationTest.pendingSnapshot(),
        )),
      { timeout: 5000 },
    );
    assert(Math.abs((await state()).top - 240) <= 2);
    await $("button=转到最新消息").click();
    await browser.waitUntil(
      async () => !(await $("[data-testid=new-messages]").isExisting()),
    );
    await browser.execute(() => {
      (window as any).conversationTest.advance();
      const article = [
        ...document.querySelectorAll<HTMLElement>("[data-row-id]"),
      ].at(-2)!;
      article.scrollIntoView({ block: "center" });
      const text = article.querySelector(".prose p")!.firstChild!;
      const range = document.createRange();
      range.selectNodeContents(text);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
    });
    const selected = await state();
    await browser.execute(() => {
      for (let i = 0; i < 700; i++) (window as any).conversationTest.advance();
    });
    await browser.waitUntil(
      async () =>
        (await $$("[data-message-id='message:synthetic-stream']").length) > 0,
      { timeout: 5000 },
    );
    const streamed = await state();
    assert.equal(streamed.selection, selected.selection);
    assert(Math.abs(streamed.top - selected.top) <= 2);
    await browser.execute(() => getSelection()!.removeAllRanges());
    const stream = $("[data-message-id='message:synthetic-stream']");
    await browser.waitUntil(
      async () =>
        (await stream.$(".prose:not(.thinking-body)").getText()).length > 5000,
      { timeout: 5000 },
    );
    const bodyBefore = await stream.$(".prose:not(.thinking-body)").getText();
    assert(bodyBefore.length > 5000);
    await $("button=思考：开").click();
    assert.equal(
      await stream.$(".prose:not(.thinking-body)").getText(),
      bodyBefore,
    );
    await $("button=思考：关").click();
    assert.equal(
      await stream.$(".prose:not(.thinking-body)").getText(),
      bodyBefore,
    );
    const failing = process.env.NATIVE_CATCHUP_FAILURE === "1";
    if (failing) await $("button=思考：开").click();
    await browser.execute(() =>
      (window as any).conversationTest.publishPreview(),
    );
    await $("[data-testid=new-messages]").waitForExist({ timeout: 5000 });
    assert.equal(
      await stream.$(".prose:not(.thinking-body)").getText(),
      bodyBefore,
    );
    await browser.execute((fail) => {
      (window as any).conversationTest.contentMode(700, fail);
      (window as any).conversationTest.completePreview();
    }, failing);
    await browser.waitUntil(
      async () => (await stream.getText()).includes("已记录 · 完成"),
      { timeout: 5000 },
    );
    const completionBody = await stream
      .$(".prose:not(.thinking-body)")
      .getText();
    assert(
      completionBody.length >= bodyBefore.length,
      "durable first fragment must never shrink displayed text",
    );
    if (failing) {
      await $("[role=alert]").waitForExist({ timeout: 5000 });
      assert.equal(
        await stream.$(".prose:not(.thinking-body)").getText(),
        bodyBefore,
      );
      await browser.execute(() =>
        (window as any).conversationTest.contentMode(0, false),
      );
      await stream.$("button=重试读取正文").click();
    }
    await browser.waitUntil(
      async () =>
        !(await stream.$("[data-testid=retained-preview]").isExisting()),
      { timeout: 10000 },
    );
    const finalText = await stream.$(".prose:not(.thinking-body)").getText();
    fs.writeFileSync(
      `${out}/completion-debug.json`,
      JSON.stringify({ bodyBefore, finalText }),
    );
    assert.equal(
      finalText.trimEnd(),
      bodyBefore.trimEnd() + "。",
      "EOF reveals only the withheld final grapheme",
    );
    const commands = await browser.execute(() =>
      (window as any).conversationTest.commands(),
    );
    assert.deepEqual(commands, []);
    fs.writeFileSync(
      `${out}/reading.json`,
      JSON.stringify(
        {
          snapshot_anchor_drift: after.offset - before.offset,
          selection_while_streaming: true,
          freeze_stream_body_preserved: true,
          durable_completion_in_place: true,
          durable_first_fragment_no_shrink: true,
          failed_catchup_preserves_text: failing,
          auto_catchup: !failing,
          over_5000_units_toggle_preserved: true,
          stream_scroll_drift: streamed.top - selected.top,
          commands,
        },
        null,
        2,
      ),
    );
    await browser.saveScreenshot(`${out}/reading.png`);
  });
});
