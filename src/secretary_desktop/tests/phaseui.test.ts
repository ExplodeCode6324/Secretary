import { test } from "node:test";
import assert from "node:assert/strict";
import { initial, displayName } from "../src/phaseui/identity";
import { sendShortcut } from "../src/phaseui/input";
import { seeded } from "../src/phaseui/motion/controller";
import { plan, secondFrame, thirdFrame } from "../src/phaseui/motion/renderer";
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
