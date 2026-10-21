import { browser, $ } from "@wdio/globals";
import assert from "node:assert/strict";
import fs from "node:fs";
const out = process.env.PHASEUI_EVIDENCE!;
const painted = () =>
  browser.executeAsync((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => done(true))),
  );
describe("Master visual corrections in native WKWebView", () => {
  before(async () => {
    fs.mkdirSync(out, { recursive: true });
    await $("#draft").waitForDisplayed({ timeout: 20000 });
    await browser.executeAsync((done) =>
      Promise.all([
        document.fonts.load('italic 700 14px "Noto Serif"', "Italic"),
        document.fonts.load('italic 700 14px "Noto Sans"', "Italic"),
        document.fonts.ready,
      ]).then(() => done(true)),
    );
  });
  it("loads offline Noto faces and aligns the heading at wide and narrow sizes", async () => {
    for (const fontSize of [14, 18]) {
      await browser.execute(
        (size) =>
          document
            .querySelector<HTMLElement>(".phaseui")!
            .style.setProperty("--font-size", size + "px"),
        fontSize,
      );
      for (const width of [1180, 600, 480]) {
        await browser.executeAsync(
          (width, done) =>
            (window as any).__TAURI__.core
              .invoke("phaseui_view", { width, zoom: 1, height: 820 })
              .then(() => done(true)),
          width,
        );
        await browser.waitUntil(
          async () =>
            await browser.execute((w) => Math.abs(innerWidth - w) < 2, width),
        );
        const result = await browser.execute(() => {
          const style = (s: string) =>
            getComputedStyle(document.querySelector(s)!);
          return {
            fonts: [...document.fonts]
              .filter((f) => f.status === "loaded")
              .map((f) => f.family),
            ui: style(".phase-brand").fontFamily,
            prose: style(".phase-message .prose").fontFamily,
            code: style(".phase-message pre").fontFamily,
            delta:
              document
                .querySelector(".phase-page-heading")!
                .getBoundingClientRect().bottom -
              document
                .querySelector("[data-page=conversation]")!
                .getBoundingClientRect().bottom,
            shadow: style("[data-identity-source]").textShadow,
          };
        });
        assert(Math.abs(result.delta) < 1, JSON.stringify(result));
        for (const face of ["Noto Sans", "Noto Serif", "Noto Sans CJK SC"])
          assert(
            result.fonts.some((f) => f.replaceAll('"', "") === face),
            JSON.stringify(result),
          );
        assert(result.ui.includes("Noto Sans"));
        assert(result.prose.includes("Noto Serif"));
        assert(result.code.includes("monospace"));
        assert.equal(result.shadow, "none");
        await painted();
        await browser.saveScreenshot(
          `${out}/layout-${width}-font-${fontSize}.png`,
        );
      }
    }
    await browser.execute(() =>
      document
        .querySelector<HTMLElement>(".phaseui")!
        .style.setProperty("--font-size", "14px"),
    );
    await browser.executeAsync((done) =>
      (window as any).__TAURI__.core
        .invoke("phaseui_view", { width: 1180, zoom: 1, height: 820 })
        .then(() => done(true)),
    );
  });
  it("uses a dark scrollbar and one focus border, with the receipt below the editor", async () => {
    await $("button=深色模式").click();
    await $("#draft").setValue("Visual review English 中文");
    const styles = await browser.execute(() => ({
      scheme: getComputedStyle(document.querySelector("main.connected")!)
        .colorScheme,
      track: getComputedStyle(
        document.querySelector("main.connected")!,
        "::-webkit-scrollbar-track",
      ).backgroundColor,
      outline: getComputedStyle(document.querySelector("#draft")!).outlineStyle,
    }));
    assert.equal(styles.scheme, "dark");
    assert.equal(styles.track, "rgb(0, 0, 0)");
    assert.equal(styles.outline, "none");
    await painted();
    await browser.saveScreenshot(`${out}/dark-enabled.png`);
    await $("[data-testid=send]").click();
    await browser.waitUntil(async () =>
      (await $(".phase-send-status").getText()).startsWith("模拟请求已排队："),
    );
    assert(
      await browser.execute(
        () =>
          document.querySelector(".phase-send-status")!.getBoundingClientRect()
            .top >
          document.querySelector("#composer-boundary")!.getBoundingClientRect()
            .bottom,
      ),
    );
    assert.equal(
      await $(".phase-page-heading + .phase-banner").isExisting(),
      false,
    );
    await painted();
    await browser.saveScreenshot(`${out}/dark-receipt.png`);
  });
  it("reconstructs multiple source gaps in three frames without residue", async () => {
    for (const selector of [
      ".phase-page-heading .phase-divider",
      "#composer-boundary",
    ]) {
      const geometries = [];
      for (const frame of [1, 2, 3]) {
        const result = await browser.execute(
          (selector, frame) => {
            const c = (window as any).phaseTest;
            c.configure({ mode: "extended", freeze: frame, seed: 0 });
            const n = document.querySelector(selector)!;
            c.targets.get(n).last = -1000;
            c.play(n);
            const shown = [...n.querySelectorAll("[data-phase-frame]")].filter(
              (e) => +getComputedStyle(e).opacity > 0.5,
            );
            return shown.map((e) => ({
              frame: e.getAttribute("data-phase-frame"),
              gaps: [...e.querySelectorAll(".source-gap")].map(
                (x) => x.outerHTML,
              ),
              slices: [...e.querySelectorAll(".displaced-slice")].map((x) =>
                x.getAttribute("style"),
              ),
              residue: e.querySelectorAll(".signal-residue").length,
            }));
          },
          selector,
          frame,
        );
        assert.equal(result.length, 1);
        assert.equal(result[0].frame, String(frame));
        assert(result[0].gaps.length >= 2);
        assert.equal(result[0].slices.length, result[0].gaps.length);
        assert.equal(result[0].residue, 0);
        geometries.push(JSON.stringify(result[0].gaps));
        await painted();
        await browser.saveScreenshot(
          `${out}/${selector.includes("composer") ? "input" : "divider"}-frame-${frame}.png`,
        );
      }
      assert.equal(new Set(geometries).size, 3);
    }
    await browser.execute(() =>
      (window as any).phaseTest.configure({ mode: "base", freeze: 0 }),
    );
  });
});
