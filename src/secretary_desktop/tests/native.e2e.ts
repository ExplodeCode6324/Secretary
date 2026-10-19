import { browser, $ } from "@wdio/globals";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { platform, arch, release } from "node:os";
import { loadFixture, phaseFrames } from "../src/study";
const output =
  process.env.STUDY_EVIDENCE_DIR ??
  resolve(
    "../../.demo-data/issue58/runs",
    new Date().toISOString().replaceAll(":", "-") + "-native",
  );
const read = () => browser.execute(() => (window as any).study.snapshot());
const outcomes: {
  name: string;
  state: string | undefined;
  started: string;
  ended: string;
}[] = [];
let started = "";
describe("actual WKWebView desktop spike", () => {
  beforeEach(() => {
    started = new Date().toISOString();
  });
  afterEach(function () {
    outcomes.push({
      name: this.currentTest!.title,
      state: this.currentTest!.state,
      started,
      ended: new Date().toISOString(),
    });
  });
  before(async () => {
    mkdirSync(output, { recursive: true });
    await browser.waitUntil(
      async () => browser.execute(() => !!(window as any).study),
      { timeout: 30000 },
    );
  });
  it("renders local native page and three displaced logical frames", async () => {
    assert.ok((await read()).ua.includes("AppleWebKit"));
    assert.ok(!(await read()).ua.includes("Chrome/"));
    const before = (await read()).textarea;
    for (const n of [0, 1, 2, 3]) {
      await browser.execute((n) => (window as any).study.phase(n), n);
      await browser.waitUntil(async () => (await read()).frame === n);
      const state = await browser.execute(() => ({
        snapshot: (window as any).study.snapshot(),
        paths: [...document.querySelectorAll(".phase-icon path")].map((p) => ({
          d: p.getAttribute("d"),
          transform: p.getAttribute("transform"),
        })),
        clips: [...document.querySelectorAll(".phase-icon clipPath rect")].map(
          (p) => ({
            x: p.getAttribute("x"),
            y: p.getAttribute("y"),
            height: p.getAttribute("height"),
          }),
        ),
      }));
      assert.equal(state.paths.length, 3);
      assert.deepEqual(state.snapshot.transforms, phaseFrames[n]);
      assert.deepEqual(state.snapshot.textarea, before);
      assert.equal(state.clips.length, 3);
      if (n > 0)
        assert.ok(state.snapshot.transforms.some((x: number) => x !== 0));
      assert.equal(new Set(state.paths.map((p: any) => p.d)).size, 1);
      writeFileSync(
        output + `/phase-${n}.json`,
        JSON.stringify(state, null, 2),
      );
      await browser.saveScreenshot(output + `/phase-${n}.png`);
    }
  });
  it("resets reduced motion mid-frame without shifting input hit area", async () => {
    const before = (await read()).textarea;
    await browser.execute(() => (window as any).study.phase(2));
    await browser.waitUntil(async () => (await read()).frame === 2);
    await browser.execute(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await browser.execute(() => (window as any).study.setReduced(true));
    await browser.waitUntil(async () => (await read()).frame === 0);
    assert.deepEqual((await read()).textarea, before);
    await browser.execute(() => (window as any).study.setReduced(false));
  });
  it("guards WebKit composition-order regression (synthetic, not real IME)", async () => {
    const result = await browser.execute(() => {
      const el = document.querySelector("textarea")!;
      el.focus();
      el.value = "中文，English。";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      el.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "中文" }),
      );
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          keyCode: 229,
          isComposing: false,
          bubbles: true,
          cancelable: true,
        }),
      );
      return (window as any).study.snapshot().sent.length;
    });
    assert.equal(result, 0);
    await $("textarea").click();
    await browser.keys("Enter");
    await browser.waitUntil(async () => (await read()).sent.length === 1);
    assert.equal((await read()).sent[0], "中文，English。");
    writeFileSync(
      output + "/synthetic-ime.json",
      JSON.stringify(await read(), null, 2),
    );
  });
  it("loads variable-height content, recycles nodes and preserves a retained selection", async () => {
    await browser.execute(() => (window as any).study.load());
    await browser.waitUntil(async () => (await read()).count === 1000);
    const initial = await read();
    assert.ok(initial.mounted < 1000);
    await browser.execute(() =>
      document
        .querySelector(".document-scroll")!
        .dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, isPrimary: true }),
        ),
    );
    await browser.waitUntil(async () => (await read()).mounted === 1000);
    const selected = await browser.execute(() => {
      const items = document.querySelectorAll(".message");
      const r = document.createRange();
      r.setStartBefore(items[9]);
      r.setEndAfter(items[899]);
      const s = getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
      window.dispatchEvent(new PointerEvent("pointerup"));
      return s.toString();
    });
    assert.ok(selected.includes("line9999"));
    assert.ok(selected.includes("记录 900"));
    await browser.execute(() => (window as any).study.prepend());
    assert.equal(
      await browser.execute(() => getSelection()?.toString()),
      selected,
    );
    await browser.execute(() => {
      getSelection()?.removeAllRanges();
    });
    writeFileSync(
      output + "/selection.json",
      JSON.stringify(
        {
          method: "programmatic native DOM range, not physical drag/clipboard",
          chars: selected.length,
          state: await read(),
        },
        null,
        2,
      ),
    );
  });
  it("does not submit preedit when an accessibility click ends composition", async () => {
    const before = (await read()).sent.length;
    await browser.execute(() => {
      const el = document.querySelector("textarea")!;
      el.value = "zhongwen";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      el.dispatchEvent(
        new CompositionEvent("compositionend", {
          bubbles: true,
          data: "zhongwen",
        }),
      );
      (document.querySelector(".send") as HTMLButtonElement).click();
    });
    assert.equal((await read()).sent.length, before);
    assert.equal(
      (await read()).events.at(-1).decision,
      "composition-commit-click-blocked",
    );
  });
  it("recycles after a click and retains a keyboard-selected document", async () => {
    await browser.execute(() => (window as any).study.load());
    await browser.waitUntil(async () => (await read()).count === 1000);
    await $(".document-scroll").click();
    await browser.waitUntil(
      async () => !(await read()).selection && (await read()).mounted < 1000,
    );
    await browser.execute(() =>
      (document.querySelector(".document-scroll") as HTMLElement).focus(),
    );
    await browser.keys(["Meta", "a"]);
    await browser.waitUntil(
      async () => (await read()).selection && (await read()).mounted === 1000,
    );
    const selected = await browser.execute(() => getSelection()!.toString());
    assert.ok(selected.includes("line9999"));
    await browser.execute(() => (window as any).study.prepend());
    assert.equal(
      await browser.execute(() => getSelection()!.toString()),
      selected,
    );
    await browser.execute(() => getSelection()!.removeAllRanges());
    await browser.waitUntil(
      async () => !(await read()).selection && (await read()).mounted < 1200,
    );
  });
  it("sends exactly once on an independent pointer gesture after composition ended", async () => {
    const before = (await read()).sent.length;
    await browser.execute(() => {
      const el = document.querySelector("textarea")!;
      el.value = "中文，English。";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      el.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "中文" }),
      );
    });
    await browser.execute(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await browser.execute(() => {
      const button = document.querySelector(".send") as HTMLButtonElement;
      button.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, isPrimary: true }),
      );
      button.click();
    });
    assert.equal((await read()).sent.length, before + 1);
    assert.equal((await read()).sent.at(-1), "中文，English。");
  });
  it("guards synthetic keyboard activation of Send after composition", async () => {
    const before = (await read()).sent.length;
    await browser.execute(() => {
      const el = document.querySelector("textarea")!;
      el.value = "中文，English。";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      el.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
      (document.querySelector(".send") as HTMLButtonElement).focus();
    });
    // The embedded driver does not produce the button's default activation.
    // Exercise its key guard plus click explicitly; real OS Return is recorded separately.
    await browser.execute(() => {
      const button = document.querySelector(".send") as HTMLButtonElement;
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      button.click();
    });
    assert.equal((await read()).sent.length, before + 1);
    assert.equal((await read()).sent.at(-1), "中文，English。");
  });
  it("blocks delayed pointerdown belonging to the composition-ending gesture", async () => {
    const before = (await read()).sent.length;
    await browser.execute(async () => {
      const el = document.querySelector("textarea")!;
      el.value = "zhongwen";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      const down = new PointerEvent("pointerdown", {
        bubbles: true,
        isPrimary: true,
      });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      el.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
      const button = document.querySelector(".send") as HTMLButtonElement;
      button.dispatchEvent(down);
      button.click();
    });
    assert.equal((await read()).sent.length, before);
    assert.equal(
      (await read()).events.at(-1).decision,
      "composition-commit-click-blocked",
    );
  });
  it("blocks a delayed confirmation Enter even when keyCode is 13", async () => {
    const before = (await read()).sent.length;
    await browser.execute(async () => {
      const el = document.querySelector("textarea")!;
      el.value = "中文";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      const enter = new KeyboardEvent("keydown", {
        key: "Enter",
        keyCode: 13,
        bubbles: true,
        cancelable: true,
      });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      el.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
      el.dispatchEvent(enter);
    });
    assert.equal((await read()).sent.length, before);
  });
  it("native zoom changes the actual CSS viewport at every target factor", async () => {
    await browser.execute(() => (window as any).study.setZoom(1));
    const width = await browser.execute(() => window.innerWidth);
    for (const z of [1, 1.25, 1.5, 2, 1]) {
      await browser.execute((z) => (window as any).study.setZoom(z), z);
      await browser.waitUntil(
        async () =>
          Math.abs(
            (await browser.execute(() => window.innerWidth)) - width / z,
          ) <= 2,
      );
      assert.equal((await read()).zoom, z);
    }
  });
  after(async () => {
    writeFileSync(
      output + "/final.json",
      JSON.stringify(await read(), null, 2),
    );
    const binary = resolve(
      "src-tauri/target/native-test/release/bundle/macos/Secretary Study Test.app/Contents/MacOS/secretary-desktop-spike",
    );
    const hash = (data: Buffer) =>
      createHash("sha256").update(data).digest("hex");
    writeFileSync(
      output + "/index.json",
      JSON.stringify(
        {
          status: outcomes.every((t) => t.state === "passed") ? "PASS" : "FAIL",
          command: "npm run test:native (all native cases)",
          environment: {
            platform: platform(),
            arch: arch(),
            os_release: release(),
          },
          fixture_sha256: hash(Buffer.from(JSON.stringify(loadFixture()))),
          expected:
            "All named native assertions pass; real OS IME and physical clipboard remain separate manual gates",
          actual: outcomes.map((t) => `${t.name}: ${t.state}`),
          timestamp: new Date().toISOString(),
          build:
            "native-test feature; embedded WKWebView driver, not ordinary Release",
          binary_sha256: hash(readFileSync(binary)),
          source_commit: execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim(),
          source_dirty: !!execFileSync(
            "git",
            ["status", "--porcelain", "--untracked-files=no"],
            { encoding: "utf8" },
          ).trim(),
          process: execFileSync("ps", ["-axo", "pid=,comm="], {
            encoding: "utf8",
          })
            .split("\n")
            .filter((line) => line.includes(binary))
            .map((line) => ({
              pid: Number(line.trim().split(/\s+/)[0]),
              binary: "secretary-desktop-spike (native-test)",
            })),
          outcomes,
          artifacts: readdirSync(output)
            .filter((name) => name !== "index.json")
            .map((name) => ({
              name,
              sha256: hash(readFileSync(output + "/" + name)),
            })),
        },
        null,
        2,
      ),
    );
  });
});
