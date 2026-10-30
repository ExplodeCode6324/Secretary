/** Explicit synthetic real-Core traversal measurement; no provider requests. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { Fixture } from "../offline/issue9/helpers.ts";
import {
  readMessageBody,
  bodyBytes,
  messagePath,
} from "../../src/pi_secretary/src/tui/body.ts";
import type {
  Message,
  Timeline,
} from "../../src/pi_secretary/src/api/contracts.ts";
const output = path.resolve(process.argv[2]),
  measurements: unknown[] = [];
const f = new Fixture();
await f.open();
try {
  for (const bytes of [2 * 1024 * 1024, 4 * 1024 * 1024]) {
    const unit =
      "# Heading\n\n| a | b |\n| --- | --- |\n| 中文 | x |\n\n7. seven\n8. eight\n\n";
    const source = unit.repeat(Math.ceil(bytes / Buffer.byteLength(unit)));
    const event = f.app.store.event(
      "main.message",
      {
        role: "assistant",
        content: [{ type: "text", text: source }],
        stopReason: "stop",
      },
      { session_id: f.app.host.sessionID, task_id: null, execution_id: null },
    );
    f.app.store.commit([], [event]);
    const timeline = await f.client.query<Timeline>(
      "timeline?limit=1&thinking=false&streaming=true",
    );
    const id = timeline.items.find((x) => x.kind === "message")!.id;
    let requests = 0;
    const client = {
      query: async <T>(route: string) => {
        requests++;
        return f.client.query<T>(route);
      },
    };
    const first = await client.query<Message>(
      `messages/${messagePath(id)}/content?streaming=true&thinking=false`,
    );
    const start = performance.now(),
      before = process.memoryUsage();
    let current = await readMessageBody(client, first, false);
    const walk = {
      ms: performance.now() - start,
      requests,
      sourceBytes: Buffer.byteLength(source),
      retainedBytes: bodyBytes(current),
      checkpoints: current.index!.body.checkpoints.length,
      heapDelta: process.memoryUsage().heapUsed - before.heapUsed,
    };
    const seeks = [];
    for (let n = 0; n < 3; n++) {
      const at = performance.now(),
        count = requests,
        prev = current;
      current = await readMessageBody(client, first, false, {
        previous: current,
        targets: { body: current.body.nextStart },
      });
      assert.equal(current.body.start, prev.body.nextStart);
      seeks.push({
        ms: performance.now() - at,
        requests: requests - count,
        retainedBytes: bodyBytes(current),
      });
    }
    measurements.push({ walk, seeks });
    await fs.writeFile(output, JSON.stringify(measurements, null, 2));
  }
} finally {
  await f.close();
  await f.app.close();
}
