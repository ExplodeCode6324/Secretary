import { test } from "node:test";
import assert from "node:assert/strict";
import { tickDue } from "../src/phaseui/schedule";
test("fixed work completes under mixed 30/60Hz frames without replay bursts", () => {
  for (const period of [50, 250]) {
    let ticks = 0,
      actions = 0,
      late = 0,
      frame = 0;
    for (let now = 0; now < 60000; now += [17, 17, 34][frame++ % 3]) {
      if (tickDue(now, ticks, period, 60000 / period)) {
        late = Math.max(late, now - ticks * period);
        ticks++;
        if (ticks % (period === 50 ? 10 : 2) === 1) actions++;
      }
    }
    assert.equal(ticks, 60000 / period);
    assert.equal(actions, 120);
    assert(late < 35);
    assert(
      !tickDue(90000, ticks, period, 60000 / period),
      "no replay after scheduled workload",
    );
  }
});
