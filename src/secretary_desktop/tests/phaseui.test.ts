import { test } from "node:test";
import assert from "node:assert/strict";
import { initial, displayName } from "../src/phaseui/identity";
import { sendShortcut } from "../src/phaseui/input";
import { seeded } from "../src/phaseui/motion/controller";
import {
  plan,
  secondFrame,
  thirdFrame,
  dividerSample,
} from "../src/phaseui/motion/renderer";
import { geometry } from "../src/phaseui/geometry";
import { fixtureBridge } from "../src/phaseui/fixture";
test("identity preserves explicit casing and Unicode graphemes", () => {
  assert.equal(displayName("  "), "Secretary");
  assert.equal(displayName("secretary"), "secretary");
  assert.equal(initial("👩‍💻测试"), "👩‍💻");
  assert.equal(initial("e\u0301quipe"), "e\u0301");
});
test("composition confirmation never sends, following independent command does", () => {
  const e = {
    key: "Enter",
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    keyCode: 13,
    repeat: false,
  };
  assert(sendShortcut(e, false));
  for (const patch of [
    { metaKey: false },
    { isComposing: true },
    { keyCode: 229 },
    { repeat: true },
    { shiftKey: true },
  ])
    assert(!sendShortcut({ ...e, ...patch }, false));
  assert(!sendShortcut(e, true));
  assert(sendShortcut(e, false));
});
test("all frozen glyph plans have distinct temporal fault samples and repeatable randomness", () => {
  const a = seeded(62),
    b = seeded(62);
  for (const [name, shape] of Object.entries(geometry)) {
    const sample = plan({ ...shape, name }, 24, -1, a);
    assert.deepEqual(sample, plan({ ...shape, name }, 24, -1, b));
    assert.notDeepEqual(secondFrame(sample, { width: 24, height: 24 }), sample);
    assert.notDeepEqual(
      thirdFrame(sample, { width: 24, height: 24 }),
      secondFrame(sample, { width: 24, height: 24 }),
    );
    assert([160, 180, 200].includes(sample.duration));
    assert.equal(plan({ ...shape, name }, 16, 0).duration, 140);
  }
});
test("diagnostic bridge owns only in-memory data and preserves draft version safety", async () => {
  const f = fixtureBridge();
  assert.equal((await f.port.snapshot()).domain, "phaseui-fixture");
  await f.port.draft("phaseui-fixture", 0, "hello");
  await assert.rejects(f.port.draft("phaseui-fixture", 0, "stale"));
  await f.port.submit(
    "phaseui-fixture",
    { operation: "messages" },
    { text: "hello" },
    1,
  );
  assert.equal((await f.port.snapshot()).draft?.text, "");
  await assert.rejects(
    f.port.stop("phaseui-fixture", "fixture-instance"),
    /FIXTURE_NO_CORE/,
  );
  f.advance();
  const live = await f.port.transient("phaseui-fixture", "fixture-instance");
  assert(live?.data);
});

test("divider frames use specified non-overlapping gaps and alternating vertical offsets", () => {
  for (const width of [48, 200, 1400]) {
    const source = dividerSample(width);
    const frames = [
      source,
      secondFrame(source, { width, height: 1 }),
      thirdFrame(source, { width, height: 1 }),
    ];
    assert.equal(new Set(frames.map((f) => JSON.stringify(f.slices))).size, 3);
    const positions = [
      [0.22, 0.62],
      [0.42, 0.76],
      [0.15, 0.55, 0.61],
    ];
    const offsets = [
      [1.5, -1.5],
      [-1.5, 1.5],
      [1.5, -1.5, 1.5],
    ];
    for (const [index, frame] of frames.entries()) {
      assert.deepEqual(
        frame.slices!.map((s) => s.band.x),
        positions[index].map((p) => p * width),
      );
      assert.deepEqual(
        frame.slices!.map((s) => s.dy),
        offsets[index],
      );
      assert(
        frame.slices!.every(
          (s) => s.band.width === Math.min(14, width * 0.035),
        ),
      );
      const slices = frame.slices!;
      assert(slices.length >= 2);
      assert(slices.some((s) => s.dy > 0) && slices.some((s) => s.dy < 0));
      for (const [i, slice] of slices.entries()) {
        assert.equal(slice.dx, 0);
        assert(slice.band.x >= 0 && slice.band.x + slice.band.width <= width);
        if (i)
          assert(
            slices[i - 1].band.x + slices[i - 1].band.width < slice.band.x,
          );
      }
    }
  }
});

test("vertical divider slices never enter the selected-row blank interval", () => {
  for (const gap of [
    { start: 0, end: 48 },
    { start: 143, end: 188 },
    { start: 750, end: 800 },
  ]) {
    const sample = dividerSample(800, gap);
    for (const frame of [
      sample,
      secondFrame(sample, { width: 800, height: 1 }),
      thirdFrame(sample, { width: 800, height: 1 }),
    ]) {
      for (const { band } of frame.slices!)
        assert(band.x + band.width <= gap.start || band.x >= gap.end);
    }
  }
});
