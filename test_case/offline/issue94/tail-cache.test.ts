import test from "node:test";
import assert from "node:assert/strict";
import { RemoteViews } from "../../../src/pi_secretary/src/tui/remote.ts";
import { tailBytes } from "../../../src/pi_secretary/src/tui/artifact-tail.ts";
import { HISTORY_BYTES } from "../../../src/pi_secretary/src/tui/history.ts";
import type { Message } from "../../../src/pi_secretary/src/api/contracts.ts";
const message = (id: string): Message => ({
  id,
  kind: "message",
  revision: "1",
  text: "body",
  role: "assistant",
  call_id: null,
  next_cursor: null,
  incomplete: false,
  delivery_count: 32,
});
test("artifact pages share resident budget and follow/anchor changes do not queue unbounded reads", async () => {
  let active = 0,
    peak = 0,
    requests = 0;
  const client: any = {
    endpoint: { instance_id: "fixture" },
    query: async () => {
      requests++;
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return {
        items: [{ name: "report.txt", description: "x".repeat(120000) }],
        total: 32,
        next_cursor: null,
      };
    },
  };
  const remote = new RemoteViews(client);
  try {
    for (let i = 0; i < 80; i++)
      remote.history.items.set("m" + i, message("m" + i));
    remote.history.anchor = "m0";
    remote.focus(Array.from({ length: 80 }, (_, i) => "m" + i));
    for (let i = 0; i < 20; i++)
      remote.focus(Array.from({ length: 80 }, (_, j) => "m" + ((j + i) % 80)));
    for (let i = 0; i < 500 && (requests < 80 || active); i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(peak, 1);
    assert(requests <= 80);
    assert(
      [...remote.deliveries.values()].reduce((n, v) => n + tailBytes(v), 0) <
        HISTORY_BYTES,
    );
    const settled = requests;
    remote.focus([...remote.history.items.keys()]);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(
      requests,
      settled,
      "evicted visible entries must not refetch on each layout",
    );
  } finally {
    remote.stop();
  }
});
