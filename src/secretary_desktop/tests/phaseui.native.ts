import { browser, $, $$ } from "@wdio/globals";
import assert from "node:assert/strict";
import fs from "node:fs";
const out = process.env.PHASEUI_EVIDENCE!;
const config = async (options: object) =>
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
const counts = async () =>
  browser.execute(() => (window as any).phaseTest.counts());
const view = async (width: number, zoom = 1, height = 820) => {
  const result = await browser.executeAsync(
    (width, zoom, height, done) =>
      (window as any).__TAURI__.core
        .invoke("phaseui_view", { width, zoom, height })
        .then(() => done(true))
        .catch((e: unknown) => done(String(e))),
    width,
    zoom,
    height,
  );
  assert.equal(result, true);
  await browser.waitUntil(
    async () =>
      await browser.execute(
        (w, z, h) =>
          Math.abs(innerWidth - w / z) < 2 &&
          Math.abs(innerHeight - (h - 28) / z) < 2,
        width,
        zoom,
        height,
      ),
    { timeout: 5000 },
  );
  return result;
};
describe("PhaseUI in native WKWebView", () => {
  before(async () => {
    fs.mkdirSync(out, { recursive: true });
    await $("[data-page=conversation]").waitForDisplayed({ timeout: 20000 });
  });
  it("normal shell geometry, actual gaps and three distinct temporal frames", async () => {
    assert.equal(await $(".phaseui").getAttribute("data-theme"), "light");
    for (const scheme of [0, 1, 2])
      for (const frame of [1, 2, 3]) {
        await config({ mode: "extended", scheme, freeze: frame });
        await play("[data-page=conversation]");
        const shown = await browser.execute(() =>
          [
            ...document.querySelectorAll(
              "[data-page=conversation] [data-phase-frame]",
            ),
          ]
            .filter((e) => Number(getComputedStyle(e).opacity) > 0.5)
            .map((e) => e.getAttribute("data-phase-frame")),
        );
        assert(shown.length > 0);
        assert(
          shown.every((n) => n === String(frame)),
          JSON.stringify(shown),
        );
        assert(
          await browser.execute(
            () => !!document.querySelector("[data-page=conversation] mask"),
          ),
        );
        await browser.saveScreenshot(
          `${out}/scheme-${scheme}-frame-${frame}.png`,
        );
      }
    await config({ mode: "base", freeze: 0, scheme: 0 });
    await play("[data-page=conversation]");
    await browser.waitUntil(async () => (await counts()).effects === 0, {
      timeout: 2000,
    });
    assert.equal((await counts()).nodes, 0);
  });
  it("cancels all owned effects on mode changes, disable and pointer departure", async () => {
    await config({ mode: "extended", freeze: 2 });
    await play("[data-page=conversation]");
    assert.equal((await counts()).effects, 1);
    await config({ mode: "off" });
    assert.equal((await counts()).effects, 0);
    assert.equal((await counts()).nodes, 0);
    await play("[data-page=conversation]");
    assert.equal((await counts()).effects, 0);
    await config({ mode: "base", freeze: 2 });
    await play("[data-page=conversation]");
    await browser.execute(() =>
      document
        .querySelector("[data-page=conversation]")!
        .dispatchEvent(new Event("pointerleave")),
    );
    assert.equal((await counts()).effects, 0);
    assert.equal(
      await browser.execute(
        () =>
          getComputedStyle(
            document.querySelector("[data-page=conversation] [data-source]")!,
          ).visibility,
      ),
      "visible",
    );
    await config({ freeze: 0 });
  });
  it("bounds divider probability, contact attempts, global concurrency and owned cleanup", async () => {
    await config({ mode: "extended", freeze: 2, seed: 1000 });
    const miss = await browser.execute(() => {
      const c = (window as any).phaseTest,
        n = document.querySelector("[data-page=attention]")!,
        line = document.querySelector("[data-nav-divider]")!;
      n.dispatchEvent(new FocusEvent("focusin"));
      return { effects: c.counts().effects, last: c.targets.get(line).last };
    });
    assert.equal(miss.effects, 1); // row glyph, but the seeded separator gate misses
    await browser.pause(750);
    const last = await browser.execute(() => {
      const c = (window as any).phaseTest,
        n = document.querySelector("[data-page=attention]")!;
      n.dispatchEvent(new PointerEvent("pointerdown"));
      return c.targets.get(document.querySelector("[data-nav-divider]")).last;
    });
    assert.equal(last, miss.last, "same contact must not retry a failed gate");
    await config({ seed: 0, freeze: 2 });
    const result = await browser.execute(() => {
      const c = (window as any).phaseTest,
        before = c.counts();
      const nodes = [0, 1].map(() => {
        const n = document.createElement("div");
        n.style.cssText = "width:200px;height:1px";
        n.innerHTML = "<span data-phase-layer></span>";
        document.body.append(n);
        return n;
      });
      const registrations = nodes.map((n) =>
        c.register(n, { kind: "divider" }),
      );
      c.play(nodes[0]);
      c.play(nodes[1]);
      const active = c.counts().effects;
      registrations.forEach((r: any) => r.destroy());
      nodes.forEach((n) => n.remove());
      return { before, after: c.counts(), active };
    });
    assert.equal(result.active, 1);
    assert.deepEqual(result.after, result.before);
    await config({ freeze: 0 });
  });
  it("keeps drafts and reading position across navigation and guards IME send", async () => {
    await $("[data-testid=draft]").setValue("保留的草稿 😀");
    await browser.execute(() => {
      const p = document.querySelector<HTMLElement>("main.connected")!;
      p.scrollTop = 125;
    });
    await $("[data-page=tasks]").click();
    assert.equal(await $('[aria-label="当前活动"]').isExisting(), false);
    await $("[data-page=conversation]").click();
    assert.equal(await $("[data-testid=draft]").getValue(), "保留的草稿 😀");
    assert(
      Math.abs(
        (await browser.execute(
          () => document.querySelector("main.connected")!.scrollTop,
        )) - 125,
      ) < 2,
    );
    const before = await $$("[data-testid=message]").length;
    await browser.execute(() => {
      const t = document.querySelector("#draft")!;
      t.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      t.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          isComposing: true,
          bubbles: true,
        }),
      );
      t.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
    });
    assert.equal(await $$("[data-testid=message]").length, before);
    await browser.execute(() =>
      document.querySelector("#draft")!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
        }),
      ),
    );
    await browser.waitUntil(
      async () => (await $("[data-testid=draft]").getValue()) === "",
      { timeout: 5000 },
    );
    await browser.waitUntil(
      async () => (await $$("[data-testid=message]").length) === before + 1,
      { timeout: 5000 },
    );
  });
  it("does not replay composer effects on typing or caret clicks", async () => {
    await config({ mode: "base", freeze: 0 });
    const result = await browser.execute(() => {
      const c = (window as any).phaseTest,
        editor = document.querySelector("#draft")!,
        boundary = document.querySelector("#composer-boundary")!;
      (editor as HTMLElement).focus();
      c.clear(boundary);
      const effects = [];
      for (const event of [
        new PointerEvent("pointerdown", { bubbles: true }),
        new MouseEvent("click", { bubbles: true }),
        ...["Enter", " "].flatMap((key) =>
          [false, true].map(
            (isComposing) =>
              new KeyboardEvent("keydown", { key, isComposing, bubbles: true }),
          ),
        ),
      ]) {
        editor.dispatchEvent(event);
        effects.push(c.active.has(boundary));
      }
      return effects;
    });
    assert(result.every((v) => !v));
  });
  it("plays the selected navigation boundary and both real submit paths", async () => {
    await config({ mode: "base", freeze: 2 });
    await $("[data-page=tasks]").click();
    assert(
      await browser.execute(
        () =>
          document
            .querySelector("[data-page=tasks] [data-phase-layer]")!
            .querySelectorAll("svg").length >= 2,
      ),
    );
    await $("[data-page=conversation]").click();
    for (const method of ["click", "shortcut"]) {
      await $("#draft").setValue("feedback " + method);
      await config({ mode: "base", freeze: 2 });
      await browser.execute((method) => {
        if (method === "click")
          document
            .querySelector<HTMLButtonElement>("[data-testid=send]")!
            .click();
        else
          document.querySelector("#draft")!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              metaKey: true,
              bubbles: true,
            }),
          );
      }, method);
      await browser.waitUntil(
        async () => (await $("#draft").getValue()) === "",
      );
      assert(
        await browser.execute(() =>
          (window as any).phaseTest.active.has(
            document.querySelector("[data-testid=send]"),
          ),
        ),
        method + " retains feedback after draft clears",
      );
      assert(
        await browser.execute(
          () =>
            document
              .querySelector("[data-testid=send] [data-phase-layer]")!
              .querySelectorAll("svg").length >= 2,
        ),
      );
    }
    await config({ freeze: 0 });
  });
  it("restores dialog focus and exposes only visible page controls", async () => {
    await $("button=连接").click();
    await $("dialog").waitForDisplayed();
    await browser.keys(["Escape"]);
    await browser.waitUntil(async () => !(await $("dialog").isDisplayed()));
    assert.equal(
      await browser.execute(() => document.activeElement?.textContent?.trim()),
      "连接",
    );
    await $("[data-page=memory]").click();
    assert.equal(await $("[data-testid=draft]").isDisplayed(), false);
    await $("[data-page=conversation]").click();
  });
  it("checks actual CSS breakpoint widths, zoom, dark mode and recovery", async () => {
    const results = [];
    for (const width of [
      480, 599, 600, 601, 849, 850, 851, 1099, 1100, 1101, 1180,
    ]) {
      assert.equal(await view(width), true);
      await browser.waitUntil(
        async () => (await browser.execute(() => innerWidth)) === width,
      );
      await browser.waitUntil(
        async () =>
          (await browser.execute(
            () =>
              document.querySelector(".phase-rail")!.getBoundingClientRect()
                .width,
          )) === (width <= 850 ? 48 : width <= 1100 ? 230 : 270),
        { timeout: 3000 },
      );
      const r = await browser.execute(() => ({
        width: innerWidth,
        side: document.querySelector(".phase-sidebar")!.getBoundingClientRect()
          .width,
        rail: document.querySelector(".phase-rail")!.getBoundingClientRect()
          .width,
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      assert.equal(r.side, width <= 600 ? 64 : width <= 1100 ? 166 : 196);
      assert.equal(r.overflow, false);
      if (width <= 850) assert.equal(r.rail, 48);
      results.push(r);
      if ([480, 600, 850, 1180].includes(width))
        await browser.saveScreenshot(`${out}/width-${width}.png`);
    }
    for (const zoom of [1, 1.25, 1.5, 2]) {
      await view(1180, zoom);
      await browser.execute(() =>
        document
          .querySelector("[data-page=settings]")!
          .scrollIntoView({ block: "nearest" }),
      );
      const visible = await browser.execute(() => {
        const n = document
          .querySelector("[data-page=settings]")!
          .getBoundingClientRect();
        return (
          n.top >= 0 &&
          n.bottom <= innerHeight + 1 &&
          document.documentElement.scrollTop === 0
        );
      });
      assert(visible, `settings reachable at zoom ${zoom}`);
      const line = await browser.execute(() => ({
        edge: document
          .querySelector(".phase-sidebar > [data-edge=right]")!
          .getBoundingClientRect()
          .toJSON(),
        shell: document
          .querySelector(".phase-sidebar")!
          .getBoundingClientRect()
          .toJSON(),
      }));
      assert(
        Math.abs(line.edge.top - line.shell.top) < 1 &&
          Math.abs(line.edge.bottom - line.shell.bottom) < 1,
        "edge remains full height after sidebar scroll",
      );
      await browser.saveScreenshot(`${out}/zoom-${zoom}.png`);
    }
    await view(600, 1.25, 480);
    await browser.execute(() =>
      document
        .querySelector("[data-page=settings]")!
        .scrollIntoView({ block: "nearest" }),
    );
    const narrow = await browser.execute(() => ({
      height: innerHeight,
      rect: document
        .querySelector("[data-page=settings]")!
        .getBoundingClientRect()
        .toJSON(),
      scroll: document.querySelector(".phase-sidebar-scroll")!.scrollTop,
      extent: document.querySelector(".phase-sidebar-scroll")!.scrollHeight,
    }));
    fs.writeFileSync(`${out}/minimum-height.json`, JSON.stringify(narrow));
    assert(narrow.rect.bottom <= narrow.height + 1, JSON.stringify(narrow));
    for (const page of [
      "conversation",
      "tasks",
      "memory",
      "artifacts",
      "attention",
      "settings",
    ]) {
      const box = await browser.execute((page) => {
        const node = document.querySelector(`[data-page="${page}"]`)!;
        node.scrollIntoView({ block: "nearest" });
        const r = node.getBoundingClientRect();
        return {
          top: r.top,
          bottom: r.bottom,
          height: innerHeight,
          root: document.documentElement.scrollTop,
        };
      }, page);
      assert(
        box.top >= -1 && box.bottom <= box.height + 1 && box.root === 0,
        JSON.stringify({ page, ...box }),
      );
    }
    await view(1180);
    await $("button=深色模式").click();
    assert.equal(await $(".phaseui").getAttribute("data-theme"), "dark");
    await browser.saveScreenshot(`${out}/dark.png`);
    await $("button=动效：开").click();
    assert.equal(await $(".phaseui").getAttribute("data-motion"), "off");
    assert.equal((await counts()).effects, 0);
    fs.writeFileSync(
      `${out}/native.json`,
      JSON.stringify(
        { runtime: "WKWebView", widths: results, passed: true },
        null,
        2,
      ),
    );
  });
});
