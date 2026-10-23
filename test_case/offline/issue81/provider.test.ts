import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { normalizeContext } from "@earendil-works/pi-ai";
import {
  fixtureModel,
  roleModel,
} from "../../../src/pi_secretary/src/model.ts";
import { Store, id, hash } from "../../../src/pi_secretary/src/store.ts";
import { durableStream } from "../../../src/pi_secretary/src/transport.ts";
import { imageLeaves } from "../../../src/pi_secretary/src/vision.ts";
import {
  requestBudget,
  assertRequestBudget,
} from "../../../src/pi_secretary/src/budget.ts";
import {
  putEvidence,
  EVIDENCE_MEDIA,
} from "../../../src/pi_secretary/src/evidence.ts";
import type { ModelCall } from "../../../src/pi_secretary/src/contracts.ts";
for (const api of ["openai-completions", "openai-responses"] as const)
  test(`installed ${api} adapter sends exact image-only and ordered image blocks; durable payload rehydrates`, async () => {
    const bodies: any[] = [];
    const server = http.createServer(async (req, res) => {
      let raw = "";
      for await (const c of req) raw += c;
      bodies.push(JSON.parse(raw));
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      if (api === "openai-responses")
        res.end(
          `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "fixture", status: "completed", model: "vision-fixture", output: [], usage: { input_tokens: 10, output_tokens: 0, total_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } })}\n\n`,
        );
      else
        res.end(
          `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "vision-fixture", choices: [{ index: 0, delta: { content: "fixture" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } })}\n\ndata: [DONE]\n\n`,
        );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue81-wire-")),
      store = await Store.open(dir),
      prior = process.env.SECRETARY_VISION_BUDGET_PROFILES;
    const model = {
      ...fixtureModel,
      id: "vision-fixture",
      api,
      provider: "openai",
      baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
      input: ["text", "image"] as ("text" | "image")[],
      contextWindow: 128000,
    };
    process.env.SECRETARY_VISION_BUDGET_PROFILES = JSON.stringify([
      {
        version: 1,
        provider: model.provider,
        api,
        model: model.id,
        baseUrl: model.baseUrl,
        tokens_per_image: 8192,
        max_side: 4096,
        max_pixels: 4194304,
        source: "Synthetic test bound only",
      },
    ]);
    try {
      const images = await Promise.all(
        ["png", "jpeg"].map(async (format) => ({
          type: "image" as const,
          mimeType: `image/${format}`,
          data: (
            await sharp({
              create: {
                width: 1920,
                height: 1080,
                channels: 3,
                background: format === "png" ? "red" : "blue",
              },
            })
              [format as "png" | "jpeg"]()
              .toBuffer()
          ).toString("base64"),
        })),
      );
      for (const content of [
        [images[0]],
        [{ type: "text" as const, text: "ordered" }, ...images],
      ]) {
        const context = normalizeContext({
            messages: [{ role: "user", content, timestamp: 1 }],
          }),
          config = roleModel(model, "synthetic-loopback-only");
        const stream = durableStream(
          store,
          config.stream,
          { session_id: null, execution_id: null, task_id: null },
          id(),
          "MAIN",
        );
        const response = await (await stream(model, context)).result();
        assert.notEqual(response.stopReason, "error", response.errorMessage);
        assert.deepEqual(
          imageLeaves(bodies.at(-1)).map((i) => [i.mime, i.sha256]),
          imageLeaves(context).map((i) => [i.mime, i.sha256]),
        );
        const call = store.all<ModelCall>("ModelCall").at(-1)!;
        assert.equal(call.request.media_type, EVIDENCE_MEDIA);
        assert.deepEqual(store.read(call.request), context);
        const event = store.events("model.payload").at(-1)!,
          payload = store.read<{ payload_ref: Parameters<Store["read"]>[0] }>(
            event.payload,
          ).payload_ref;
        assert.equal(
          hash(JSON.stringify(store.read(payload))),
          hash(JSON.stringify(bodies.at(-1))),
        );
      }
      const context = normalizeContext({
        messages: [
          { role: "user", content: [...images, ...images], timestamp: 1 },
        ],
      });
      assert.ok(assertRequestBudget(model, context.messages).occupancy < 1);
      for (const reader of ["resume.request", "last.request"] as const) {
        const loop = id(),
          scope = { session_id: null, execution_id: null, task_id: null },
          config = roleModel(model, "synthetic-loopback-only");
        const prepare = durableStream(
          store,
          config.stream,
          scope,
          loop,
          "MAIN",
          {
            onPrepared: () => {
              throw Error("FIXTURE_STOP_AFTER_PREPARED");
            },
          },
        );
        await assert.rejects(
          Promise.resolve(prepare(model, context)),
          /FIXTURE_STOP_AFTER_PREPARED/,
        );
        const saved = store.all<ModelCall>("ModelCall").at(-1)!;
        assert.equal(saved.state, "PREPARED");
        const exact = hash(JSON.stringify(store.read(saved.request))),
          key = saved.logical_key;
        const replay = durableStream(
          store,
          config.stream,
          scope,
          loop,
          "MAIN",
          reader === "resume.request" ? { resumeCallID: saved.id } : {},
        );
        const supplied =
          reader === "resume.request"
            ? normalizeContext({ messages: [] })
            : structuredClone(context);
        if (reader === "last.request") supplied.messages[0].timestamp = 999;
        const answer = await (await replay(model, supplied)).result();
        assert.notEqual(answer.stopReason, "error");
        const completed = store.get<ModelCall>("ModelCall", saved.id);
        assert.equal(completed.logical_key, key);
        assert.equal(
          hash(JSON.stringify(store.read(completed.request))),
          exact,
        );
        assert.deepEqual(
          imageLeaves(bodies.at(-1)).map((i) => i.sha256),
          imageLeaves(context).map((i) => i.sha256),
        );
      }
      const before = bodies.length,
        config = roleModel(model, "synthetic-loopback-only");
      const corrupt = await config.stream(model, context, {
        onPayload: () => ({ model: model.id, max_tokens: 4096, messages: [] }),
      });
      await corrupt.result();
      assert.equal(bodies.length, before);
      const oldWire = process.env.SECRETARY_ATTACHMENT_WIRE_BYTES;
      try {
        process.env.SECRETARY_ATTACHMENT_WIRE_BYTES = "100";
        await (await config.stream(model, context)).result();
        assert.equal(bodies.length, before);
      } finally {
        if (oldWire === undefined)
          delete process.env.SECRETARY_ATTACHMENT_WIRE_BYTES;
        else process.env.SECRETARY_ATTACHMENT_WIRE_BYTES = oldWire;
      }
      const text = normalizeContext({
        messages: [{ role: "user", content: "unchanged text", timestamp: 1 }],
      });
      const textBudget = requestBudget(model, text.messages),
        profile = process.env.SECRETARY_VISION_BUDGET_PROFILES;
      delete process.env.SECRETARY_VISION_BUDGET_PROFILES;
      assert.deepEqual(requestBudget(model, text.messages), textBudget);
      assert.throws(
        () => requestBudget(model, context.messages),
        /ATTACHMENT_BUDGET_UNCONFIGURED/,
      );
      process.env.SECRETARY_VISION_BUDGET_PROFILES = profile;
      assert.throws(
        () =>
          assertRequestBudget(
            { ...model, contextWindow: 16000 },
            context.messages,
          ),
        /CAPACITY_BLOCKED/,
      );
      assert.throws(
        () => requestBudget({ ...model, input: ["text"] }, context.messages),
        /ATTACHMENT_MODEL_UNSUPPORTED/,
      );
      assert.throws(
        () =>
          requestBudget(
            { ...model, baseUrl: model.baseUrl + "/changed" },
            context.messages,
          ),
        /ATTACHMENT_BUDGET_UNCONFIGURED/,
      );
    } finally {
      if (prior === undefined)
        delete process.env.SECRETARY_VISION_BUDGET_PROFILES;
      else process.env.SECRETARY_VISION_BUDGET_PROFILES = prior;
      await store.close();
      fs.rmSync(dir, { recursive: true, force: true });
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
test("dehydrated repeated aggregate has constant image storage and exact legacy read compatibility", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue81-evidence-")),
    store = await Store.open(dir);
  try {
    const bytes = Buffer.alloc(5 * 1024 ** 2, 97),
      content = [
        {
          type: "image",
          mimeType: "image/png",
          data: bytes.toString("base64"),
        },
      ];
    const first = putEvidence(store, {
      messages: [{ role: "user", content }],
      index: 0,
    });
    const size = () =>
        fs
          .readdirSync(path.join(dir, "objects"))
          .reduce(
            (n, f) => n + fs.statSync(path.join(dir, "objects", f)).size,
            0,
          ),
      initial = size();
    for (let i = 1; i <= 20; i++) {
      const value = { messages: [{ role: "user", content }], index: i },
        ref = putEvidence(store, value);
      assert.equal(
        hash(JSON.stringify(store.read(ref))),
        hash(JSON.stringify(value)),
      );
    }
    assert.ok(size() - initial < 100000);
    assert.equal(store.read<any>(first).index, 0);
    const old = store.put({ legacy: "text" });
    assert.deepEqual(store.read(old), { legacy: "text" });
  } finally {
    await store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
