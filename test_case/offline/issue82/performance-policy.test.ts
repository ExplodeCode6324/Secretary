import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import {
  StateWriter,
  blobOf,
} from "../../../src/pi_secretary/src/tui/writer.ts";
const evidence = path.resolve(".demo-data/issue82-tui/implementation");
const run = fs.mkdtempSync(path.join(evidence, "policy-tests-"));
async function gated() {
  let clock = 0;
  const writer = new StateWriter(
    path.join(fs.mkdtempSync(path.join(run, "state-")), "tui-v1"),
    undefined,
    { now: () => clock } as any,
  );
  await writer.ready;
  const writes: any[] = [];
  const queued: Array<{ chunk: any; args: any[] }> = [];
  const original = writer.child.stdin.write.bind(writer.child.stdin);
  let wake: (() => void) | undefined;
  writer.child.stdin.write = ((chunk: any, ...args: any[]) => {
    writes.push(JSON.parse(String(chunk)));
    queued.push({ chunk, args });
    wake?.();
    wake = undefined;
    return true;
  }) as any;
  const next = async () => {
    while (!queued.length)
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    return writes.at(-1);
  };
  const release = () => {
    const item = queued.shift()!;
    (original as any)(item.chunk, ...item.args);
  };
  const close = async () => {
    writer.child.stdin.write = original;
    while (queued.length) release();
    const exit = once(writer.child, "exit");
    await writer.close();
    await exit;
  };
  return {
    writer,
    writes,
    next,
    release,
    close,
    age: (value: number) => {
      clock = value;
    },
  };
}
test("an eligible checkpoint yields once to input queued by the actual preceding ACK continuation", async () => {
  const h = await gated();
  const first = h.writer.commit({ n: 14 });
  await h.next();
  const cp = h.writer.checkpoint({ cursor: "15" }, {});
  await Promise.resolve();
  (h.writer as any).low.queuedAt = -1000;
  let continuationEmpty = false,
    continuationYield = false;
  const second = first.then(() => {
    continuationEmpty = (h.writer as any).high.length === 0;
    continuationYield = !!(h.writer as any).lowDispatch;
    return (h.writer.commit as any)({ n: 16 }, [], {}, "input-ack");
  });
  h.release();
  const selected = await h.next();
  // Drain before assertions so a failing witness leaves no child behind.
  h.release();
  await h.next();
  h.release();
  await Promise.all([second, cp]);
  await h.close();
  assert.equal(continuationEmpty, true);
  assert.equal(continuationYield, true);
  assert.equal(selected.op, "commit");
  assert.equal(selected.data.n, 16);
  assert.deepEqual(
    h.writes.map((x) => x.op),
    ["commit", "commit", "checkpoint"],
  );
});
for (const age of [249.9, 250, 499.9, 500, 5000])
  for (const used of [false, true]) {
    test(`scheduler boundary age=${age}, consumed=${used}`, async () => {
      const h = await gated();
      const first = h.writer.commit({ n: 0 });
      await h.next();
      const cp = h.writer.checkpoint({}, {});
      await Promise.resolve();
      // Synthetic state matrix isolates age and consumed-state decisions. The
      // actual consumption/coalescing lifecycle is exercised below.
      (h.writer as any).low.queuedAt = 0;
      (h.writer as any).low.bypassUsed = used;
      h.age(age);
      const input = h.writer.commit({ n: 1 }, [], {}, "input-ack");
      await Promise.resolve();
      h.release();
      const picked = await h.next();
      h.release();
      await h.next();
      h.release();
      await Promise.all([first, cp, input]);
      await h.close();
      assert.equal(picked.op, age >= 250 && used ? "checkpoint" : "commit");
      assert.ok(
        h.writes.every(
          (x) => !("intent" in x) && !("bypassUsed" in x) && !("queuedAt" in x),
        ),
      );
    });
  }
for (const head of ["read", "maintenance"]) {
  test(`eligible checkpoint does not search past ${head} head for input`, async () => {
    const h = await gated();
    const blob = blobOf("read head");
    const first = h.writer.commit({ n: 0, body: blob.ref }, [blob]);
    await h.next();
    const cp = h.writer.checkpoint({}, {});
    await Promise.resolve();
    h.age(5000);
    const middle =
      head === "read" ? h.writer.read(blob.ref) : h.writer.commit({ n: 1 });
    const input = h.writer.commit({ n: 2 }, [], {}, "input-ack");
    await Promise.resolve();
    h.release();
    for (let n = 0; n < 3; n++) {
      await h.next();
      h.release();
    }
    await Promise.all([first, cp, middle, input]);
    await h.close();
    assert.deepEqual(
      h.writes.map((x) => x.op),
      ["commit", "checkpoint", head === "read" ? "read" : "commit", "commit"],
    );
  });
}
test("consumption and original age survive coalescing; only first of two input heads bypasses", async () => {
  const h = await gated();
  const first = h.writer.commit({ n: 0 });
  await h.next();
  const old = h.writer
    .checkpoint({ cursor: "old" }, {})
    .catch((e) => e.message);
  await Promise.resolve();
  h.age(500);
  const one = h.writer.commit({ n: 1 }, [], {}, "input-ack"),
    two = h.writer.commit({ n: 2 }, [], {}, "input-ack");
  await Promise.resolve();
  h.release();
  await h.next();
  assert.equal((h.writer as any).low.bypassUsed, true);
  const cp = h.writer.checkpoint({ cursor: "new" }, {});
  await Promise.resolve();
  assert.equal((h.writer as any).low.queuedAt, 0);
  assert.equal((h.writer as any).low.bypassUsed, true);
  h.release();
  await h.next();
  h.release();
  await h.next();
  h.release();
  await Promise.all([first, one, two, cp]);
  assert.equal(await old, "CHECKPOINT_COALESCED");
  await h.close();
  assert.deepEqual(
    h.writes.map((x) => x.op),
    ["commit", "commit", "checkpoint", "commit"],
  );
  assert.equal(h.writes[2].value.cursor, "new");
});
test("a new checkpoint gets a new allowance after the previous checkpoint dispatch", async () => {
  const h = await gated();
  const first = h.writer.commit({ n: 0 });
  await h.next();
  const old = h.writer.checkpoint({}, {});
  await Promise.resolve();
  h.age(500);
  const one = h.writer.commit({ n: 1 }, [], {}, "input-ack");
  await Promise.resolve();
  h.release();
  await h.next();
  h.release();
  await h.next();
  // Old checkpoint is now in flight. New pending checkpoint is a distinct slot.
  const cp = h.writer.checkpoint({ cursor: "next" }, {});
  await Promise.resolve();
  assert.equal((h.writer as any).low.bypassUsed, false);
  h.age(1000);
  const two = h.writer.commit({ n: 2 }, [], {}, "input-ack");
  await Promise.resolve();
  h.release();
  await h.next();
  h.release();
  await h.next();
  h.release();
  await Promise.all([first, old, one, cp, two]);
  await h.close();
  assert.deepEqual(
    h.writes.map((x) => x.op),
    ["commit", "commit", "checkpoint", "commit", "checkpoint"],
  );
});
test("an already running checkpoint is not preempted by input (#47 exposure)", async () => {
  const h = await gated();
  const cp = h.writer.checkpoint({}, {});
  await h.next();
  h.age(1000);
  const input = h.writer.commit({ n: 47 }, [], {}, "input-ack");
  await Promise.resolve();
  assert.equal(h.writes.length, 1);
  h.release();
  await h.next();
  h.release();
  await Promise.all([cp, input]);
  await h.close();
  assert.deepEqual(
    h.writes.map((x) => x.op),
    ["checkpoint", "commit"],
  );
});
