import { browser, $, $$ } from "@wdio/globals";
import assert from "node:assert/strict";
import fs from "node:fs";
const out = process.env.PHASEUI_EVIDENCE!;
const configure = async (options: object) =>
  browser.execute(
    (options) => (window as any).phaseTest.configure(options),
    options,
  );
const play = async (selector: string) =>
  browser.execute(
    (selector) =>
      (window as any).phaseTest.play(document.querySelector(selector)),
    selector,
  );
describe("PhaseUI public gallery consumers", () => {
  before(async () => {
    fs.mkdirSync(out, { recursive: true });
    await $('input[aria-label="品牌名称"]').waitForDisplayed({
      timeout: 20000,
    });
  });
  it("keeps all gallery mode controls consistent with shell CSS", async () => {
    for (const label of ["BASE", "EXTENDED"]) {
      await $("button=off").click();
      await browser.waitUntil(
        async () => (await $(".phaseui").getAttribute("data-motion")) === "off",
      );
      await $("button=" + label).click();
      await browser.waitUntil(
        async () =>
          (await $(".phaseui").getAttribute("data-motion")) ===
          label.toLowerCase(),
      );
    }
  });
  it("renders all consumer examples and Unicode/long identity without changing semantic names", async () => {
    for (const label of [
      "#63 Conversation",
      "#64 Task / decision",
      "#65 Settings",
      "#66 Artifact / notification",
    ])
      assert(await $(`h3=${label}`).isExisting());
    const name = "超长助手名称 Secretary e\u0301quipe 👩‍💻";
    await $('input[aria-label="品牌名称"]').setValue(name);
    assert.equal(await $(".phase-brand").getAttribute("aria-label"), name);
    await configure({ mode: "extended", freeze: 2, scheme: 0 });
    await play(".phase-brand");
    assert.equal(await $(".phase-brand").getAttribute("aria-label"), name);
    assert.equal(
      await browser.execute(() =>
        document
          .querySelector(".phase-brand [data-phase-layer]")
          ?.getAttribute("aria-hidden"),
      ),
      "true",
    );
    await browser.saveScreenshot(`${out}/long-brand-frame2.png`);
    await configure({ freeze: 0 });
  });
  it("uses only an underline for text buttons and a wrapper for form controls", async () => {
    await configure({ mode: "base", freeze: 1 });
    const selector = ".phase-gallery-grid .phase-text-button:not(:disabled)";
    await play(selector);
    const paths = await browser.execute(
      (selector) =>
        [
          ...document.querySelectorAll(selector + " [data-phase-layer] path"),
        ].map((e) => e.getAttribute("d")),
      selector,
    );
    assert(paths.length);
    assert(
      paths.every((p) => p && !p.includes("Z")),
      "text button must not acquire a rectangular perimeter",
    );
    await play(".phase-gallery-grid .phase-input");
    assert.equal(
      await browser.execute(
        () =>
          document.querySelectorAll(
            "input [data-phase-layer],select [data-phase-layer],textarea [data-phase-layer]",
          ).length,
      ),
      0,
    );
    assert(
      await browser.execute(
        () =>
          document.querySelector(
            ".phase-gallery-grid .phase-input [data-phase-layer]",
          )!.children.length > 0,
      ),
    );
    await configure({ mode: "reduced" });
    assert.equal(
      await browser.execute(() => (window as any).phaseTest.counts().effects),
      0,
    );
  });
  it("enlarges real component text and retains both avatar source roles", async () => {
    // Driver popup selection did not dispatch native change; real CUA menu selection is recorded separately.
    const selects = await $$("select");
    const values = await selects.map((x) => x.getHTML());
    const i = values.findIndex((x) => x.includes("18px"));
    assert(i >= 0);
    await browser.execute((index) => {
      const select = document.querySelectorAll("select")[index];
      select.value = "18";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, i);
    fs.writeFileSync(
      `${out}/font-debug.json`,
      JSON.stringify(
        await browser.execute(() => ({
          selects: [...document.querySelectorAll("select")].map((n) => ({
            html: n.outerHTML,
            value: n.value,
          })),
          root: document.querySelector(".phaseui")!.getAttribute("style"),
        })),
        null,
        2,
      ),
    );
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          getComputedStyle(document.querySelector(".phaseui")!)
            .getPropertyValue("--font-size")
            .trim(),
        )) === "18px",
      { timeout: 3000 },
    );
    await configure({ mode: "base", freeze: 3 });
    for (const selector of [
      '.phase-gallery-grid .phase-avatar[aria-label="Master"]',
      '.phase-gallery-grid .phase-avatar[aria-label="Secretary"]',
    ]) {
      await play(selector);
      assert(
        await browser.execute(
          (selector) =>
            document.querySelector(selector + ' [data-identity-frame="3"]') !==
            null,
          selector,
        ),
      );
    }
    await browser.saveScreenshot(`${out}/text18-avatars.png`);
    await configure({ mode: "off" });
    fs.writeFileSync(
      `${out}/gallery.json`,
      JSON.stringify(
        { passed: true, mode: "native-test", systemIME: "NOT_TESTED" },
        null,
        2,
      ),
    );
  });
});
