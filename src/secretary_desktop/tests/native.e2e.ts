import { browser, $ } from "@wdio/globals";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const output =
  process.env.STUDY_EVIDENCE_DIR ??
  resolve(
    "../../.demo-data/issue58/runs",
    new Date().toISOString().replaceAll(":", "-") + "-native",
  );
const read = () => browser.execute(() => (window as any).study.snapshot());
const outcomes: { name: string; state: string | undefined }[] = [];
describe("actual WKWebView desktop spike", () => {
  afterEach(function () {
    outcomes.push({
      name: this.currentTest!.title,
      state: this.currentTest!.state,
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
    await browser.execute(() => {
      (window as any).study.phase(2);
      (window as any).study.setReduced(true);
    });
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
        .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
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
  it("native WebView zoom accepts all target factors", async () => {
    for (const z of [1, 1.25, 1.5, 2, 1]) {
      await browser.execute((z) => (window as any).study.setZoom(z), z);
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
          command: "npm run test:native",
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
