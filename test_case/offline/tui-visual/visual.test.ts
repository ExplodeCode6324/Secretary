import test from "node:test";
import assert from "node:assert/strict";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import type {
  Message,
  TimelineItem,
} from "../../../src/pi_secretary/src/api/contracts.ts";
import {
  ActivityIndicator,
  mainActivity,
} from "../../../src/pi_secretary/src/tui/activity-indicator.ts";
import { Splash } from "../../../src/pi_secretary/src/tui/splash.ts";
import { SPLASH_PORTRAIT } from "../../../src/pi_secretary/src/tui/splash-art.ts";
import {
  paint,
  paintHex,
  setColorDepth,
} from "../../../src/pi_secretary/src/tui/theme.ts";
import { messageComponent } from "../../../src/pi_secretary/src/tui/view.ts";

const message = (role: string, text: string, extra = {}) =>
  ({
    id: "m1",
    kind: "message",
    role,
    text,
    revision: "1",
    persistence: "durable",
    ...extra,
  }) as unknown as Message;
const activity = (kind: string, status: string, extra = {}) =>
  ({
    id: kind,
    kind: "activity",
    revision: "1",
    activity: { id: kind, kind, status, phase: kind + " phase", ...extra },
  }) as TimelineItem;

test("theme: three colour depths, one vocabulary", () => {
  setColorDepth("truecolor");
  assert.equal(paint("sky")("x"), "\x1b[38;2;177;213;236mx\x1b[0m");
  setColorDepth("256");
  assert.equal(paint("sky", "bold")("x"), "\x1b[1;38;5;153mx\x1b[0m");
  // Art colours have no hand-picked index: nearest cube entry or grey, hue preserved.
  assert.equal(paintHex("#ffb83e")("x"), "\x1b[38;5;215mx\x1b[0m");
  assert.equal(paintHex("#9dbcff")("x"), "\x1b[38;5;147mx\x1b[0m");
  assert.equal(paintHex("#ffffff")("x"), "\x1b[38;5;231mx\x1b[0m");
  assert.equal(paintHex("#3b3b4f")("x"), "\x1b[38;5;238mx\x1b[0m");
  setColorDepth("none");
  assert.equal(paint("sky")("x"), "x");
});

test("Master box: every row is exactly the viewport width, CJK included, and rows stay mapped", () => {
  setColorDepth("256");
  for (const width of [16, 37, 80]) {
    const mapped = messageComponent(
      message(
        "master",
        "重做，超时放宽到 10 分钟。\n\n- `a`\n- **b** 中文😀 mixed",
      ),
    ).renderMapped!(width);
    const box = mapped.lines.slice(0, -1); // last row is the spacer
    assert.equal(mapped.rows.length, mapped.lines.length);
    for (const line of box) assert.equal(visibleWidth(line), width, line);
    assert.match(stripTerminalSequences(box[0]), /^╭─ Master ─*╮$/);
    assert.match(stripTerminalSequences(box.at(-1)!), /^╰─+╯$/);
    assert.equal(mapped.rows[0].region, "header");
    assert.equal(mapped.rows.at(-2)!.region, "header");
    assert(mapped.rows.slice(1, -2).every((row) => row.region === "body"));
  }
});

test("Master box: too narrow falls back to rules; other roles are never boxed", () => {
  setColorDepth("256");
  const narrow = messageComponent(message("master", "hi")).render(12);
  assert.match(stripTerminalSequences(narrow[0]), /── Master ──/);
  const reply = messageComponent(message("assistant", "hi")).render(40);
  assert.doesNotMatch(stripTerminalSequences(reply.join("\n")), /[╭╮╰╯│]/);
});

test("Master box cannot be forged or broken by message content", () => {
  setColorDepth("256");
  const lines = messageComponent(
    message("master", "a\x1b[2J\x1b[0m│╯ b\x07"),
  ).render(40);
  assert.doesNotMatch(lines.join("\n"), /\x1b\[2J|\x07/);
  for (const line of lines.slice(0, -1)) assert.equal(visibleWidth(line), 40);
});

test("activity: derived from Core state only; background work never makes Main look busy", () => {
  assert.equal(mainActivity([]), undefined);
  assert.equal(
    mainActivity([activity("model", "running", { execution_id: "e1" })]),
    undefined,
  );
  assert.equal(mainActivity([activity("model", "succeeded")]), undefined);
  assert.equal(
    mainActivity([activity("model", "running", { phase: "正在思考" })])?.kind,
    "thinking",
  );
  assert.equal(
    mainActivity([
      activity("model", "running"),
      activity("tool", "running", { phase: "x\x1b[2J\ny" }),
    ])?.label,
    "x y",
  );
  assert.equal(
    mainActivity([
      message("assistant", "partial", {
        persistence: "transient",
        preview_status: "running",
      }),
      activity("model", "running"),
    ])?.kind,
    "replying",
  );
  // Sent but unconfirmed is "sending", never "thinking" (IN-05); a conflict is not progress.
  assert.equal(mainActivity([], { status: "UNKNOWN" })?.kind, "sending");
  assert.equal(mainActivity([], { status: "CONFLICT" }), undefined);
  assert.equal(mainActivity([], { status: "ACCEPTED" }), undefined);
});

test("indicator: always one row, blank when idle, deterministic per clock value", () => {
  setColorDepth("256");
  const indicator = new ActivityIndicator();
  assert.deepEqual(indicator.render(80), [""]);
  indicator.activity = {
    kind: "thinking",
    label: "正在思考",
    since: "2026-11-13T05:00:00Z",
  };
  indicator.now = () => Date.parse("2026-11-13T05:01:05Z");
  const first = indicator.render(80);
  assert.equal(first.length, 1);
  assert.deepEqual(indicator.render(80), first);
  assert.match(stripTerminalSequences(first[0]), /正在思考 · 1m05s$/);
  indicator.motion = false;
  assert.match(stripTerminalSequences(indicator.render(80)[0]), /^ ● 正在思考/);
  assert(visibleWidth(indicator.render(10)[0]) <= 10);
});

test("splash: picks a tier that fits, never exceeds the slot, works without colour", () => {
  const splash = new Splash();
  splash.info = { connection: "ready", mainModel: "p · m", mode: "live" };
  for (const depth of ["truecolor", "256", "none"] as const) {
    setColorDepth(depth);
    for (const [width, height] of [
      [140, 40],
      [100, 30],
      [80, 18],
      [60, 30],
      [40, 10],
      [20, 3],
    ]) {
      splash.height = () => height;
      const lines = splash.render(width);
      assert(lines.length <= height, `${width}x${height}`);
      for (const line of lines)
        assert(visibleWidth(line) <= width, `${width}x${height}: ${line}`);
    }
  }
  setColorDepth("none");
  splash.height = () => 40;
  const rows = splash.render(140),
    big = rows.join("\n");
  assert(rows.filter((row) => /[\u2801-\u28ff]/.test(row)).length >= 20);
  assert(rows.length >= SPLASH_PORTRAIT.cells.length);
  assert(big.includes("S E C R E T A R Y"));
  assert.doesNotMatch(big, /\x1b/);
  splash.height = () => 3;
  assert.doesNotMatch(splash.render(20).join("\n"), /[⠁-⣿]/);
});

test("splash art asset is rectangular and its ink only references its palette", async () => {
  const art = await import("../../../src/pi_secretary/src/tui/splash-art.ts");
  for (const asset of [art.SPLASH_PORTRAIT, art.SPLASH_HALO]) {
    assert.equal(asset.cells.length, asset.ink.length);
    asset.cells.forEach((row, i) => {
      assert.equal(Array.from(row).length, asset.cols);
      assert.equal(asset.ink[i].length, asset.cols);
      assert.match(row, /^[⠀-⣿]+$/);
      for (const slot of asset.ink[i].replace(/ /g, ""))
        assert(parseInt(slot, 16) < asset.palette.length);
    });
  }
});
