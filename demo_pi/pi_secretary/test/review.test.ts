import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { App } from "../src/app.ts";
import { TerminalController } from "../src/tui.ts";
import { revise, Store } from "../src/store.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../src/model.ts";
import type { Input, Notification } from "../src/contracts.ts";

async function fixture(
  run: (app: App, dir: string) => Promise<void>,
  stream: StreamFn = fixtureStream,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-review-"));
  const app = await App.open(dir, { model: fixtureModel, stream });
  try {
    await run(app, dir);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("rejected multi-record transaction changes neither journal nor projection", () =>
  fixture(async (app, dir) => {
    const a = app.host.accept("first"),
      b = app.host.accept("second");
    const bad = app.store.put("missing");
    fs.unlinkSync(path.join(dir, bad.path));
    const before = fs.readFileSync(path.join(dir, "journal.jsonl"));
    assert.throws(() =>
      app.store.commit([
        revise(a, { state: "CLAIMED", loop_id: a.id }),
        revise(b, { payload: bad }),
      ]),
    );
    assert.deepEqual(fs.readFileSync(path.join(dir, "journal.jsonl")), before);
    assert.equal(app.store.get<Input>("Input", a.id).state, "ACCEPTED");
    await app.close();
    const reopened = await Store.open(dir);
    try {
      assert.equal(reopened.get<Input>("Input", a.id).state, "ACCEPTED");
    } finally {
      await reopened.close();
    }
  }));

test("queued notification survives restart and becomes SENT only on TUI presentation", async () => {
  const stream: StreamFn = (model, context, options) =>
    context.messages.some((m) => m.role === "toolResult")
      ? fixtureStream(model, context, options)
      : replyStream(
          [
            {
              type: "toolCall",
              id: "notify",
              name: "MasterInteract",
              arguments: { message: "durable notification" },
            },
          ],
          model,
        );
  await fixture(async (app, dir) => {
    app.host.accept("notify");
    await app.host.drain();
    const n = app.store.all<Notification>("Notification")[0];
    assert.equal(n.state, "QUEUED");
    assert.equal(n.receipt, null);
    await app.close();
    const restored = await App.open(dir, {
      model: fixtureModel,
      stream: fixtureStream,
    });
    try {
      const output: string[] = [];
      const tui = new TerminalController(restored, (text) => output.push(text));
      tui.refresh();
      tui.refresh();
      assert.equal(
        output.filter((text) => text.includes("durable notification")).length,
        1,
      );
      const sent = restored.store.get<Notification>("Notification", n.id);
      assert.equal(sent.state, "SENT");
      assert(sent.receipt);
    } finally {
      await restored.close();
    }
  }, stream);
});

test("original input constraint reaches the next real Pi request after lossy compaction", async () => {
  const seen: string[] = [];
  const stream: StreamFn = (model, context, options) => {
    const raw = JSON.stringify(context);
    if (raw.includes("CONSCIOUSNESS:"))
      return replyStream(
        [
          {
            type: "text",
            text: JSON.stringify({
              items: [
                {
                  tier: "QUIET",
                  summary: "unrelated",
                  goals: [],
                  constraints: [],
                  decisions: [],
                  open_questions: [],
                  unfulfilled_commitments: [],
                  task_refs: [],
                  pending_owner: "MAIN",
                },
              ],
            }),
          },
        ],
        model,
      );
    seen.push(raw);
    return fixtureStream(model, context, options);
  };
  await fixture(async (app) => {
    app.host.accept("EXACT_CONSTRAINT_NO_EXTERNAL_PAYMENTS");
    await app.host.drain();
    await app.host.compact();
    seen.length = 0;
    app.host.accept("continue");
    await app.host.drain();
    assert(
      seen.some((raw) => raw.includes("EXACT_CONSTRAINT_NO_EXTERNAL_PAYMENTS")),
    );
  }, stream);
});
