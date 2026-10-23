import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { ApplicationService } from "../../../src/pi_secretary/src/application-service.ts";
import {
  fixtureModel,
  roleModel,
} from "../../../src/pi_secretary/src/model.ts";
import { hash, id } from "../../../src/pi_secretary/src/store.ts";
import { imageLeaves } from "../../../src/pi_secretary/src/vision.ts";
import type {
  AttachmentImport,
  Input,
  Context,
} from "../../../src/pi_secretary/src/contracts.ts";
for (const api of ["openai-completions", "openai-responses"] as const)
  test(`actual ${api} HTTP 400 with no assistant output permits withdrawal and queued text`, async () => {
    const bodies: any[] = [];
    const server = http.createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      bodies.push(body);
      if (imageLeaves(body).length) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message: "Synthetic image rejected",
              type: "invalid_request_error",
            },
          }),
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      if (api === "openai-responses")
        res.end(
          `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "fixture", status: "completed", model: "vision-fixture", output: [], usage: { input_tokens: 10, output_tokens: 0, total_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } })}\n\n`,
        );
      else
        res.end(
          `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "vision-fixture", choices: [{ index: 0, delta: { content: "text succeeds" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } })}\n\ndata: [DONE]\n\n`,
        );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue81-reject-")),
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
        source: "Synthetic loopback fixture",
      },
    ]);
    const app = await App.open(
        dir,
        roleModel(model, "synthetic-loopback-only"),
      ),
      service = new ApplicationService(app);
    try {
      const bytes = await sharp({
        create: { width: 16, height: 16, channels: 3, background: "red" },
      })
        .png()
        .toBuffer();
      const file = path.join(dir, "image.png"),
        request = id();
      fs.writeFileSync(file, bytes);
      service.command(service.principal, "attachments/import", {
        request_id: request,
        source_path: file,
        expected_bytes: String(bytes.length),
        expected_sha256: hash(bytes),
        name: "image.png",
      });
      await service.attachmentImports.settle();
      const attachment = app.store.get<AttachmentImport>(
        "AttachmentImport",
        request,
      ).attachment_id;
      const input = app.host.accept("rejected image", id(), "MASTER", [
        attachment,
      ]);
      const queued = app.host.accept("queued safe text");
      await app.host.drain();
      assert.equal(app.host.session.state, "RECOVERY_BLOCKED");
      assert.equal(bodies.filter((b) => imageLeaves(b).length).length, 1);
      service.command(service.principal, `inputs/${input.id}/withdraw`, {
        request_id: id(),
        expected_revision: String(
          app.store.get<Input>("Input", input.id).revision,
        ),
      });
      await app.host.drain();
      assert.equal(
        app.host.session.state,
        "IDLE",
        app.host.session.recovery_error ?? "",
      );
      assert.equal(app.store.get<Input>("Input", queued.id).state, "HANDLED");
      assert.equal(app.store.get<Input>("Input", input.id).state, "WITHDRAWN");
      const checkpoint = app.store.get<Context>(
        "Context",
        app.host.session.last_context_id!,
      );
      assert.equal(
        imageLeaves(app.store.read(checkpoint.raw_context)).length,
        0,
      );
      assert.equal(bodies.length, 2);
    } finally {
      await service.close();
      await app.close();
      await new Promise<void>((r) => server.close(() => r()));
      fs.rmSync(dir, { recursive: true, force: true });
      if (prior === undefined)
        delete process.env.SECRETARY_VISION_BUDGET_PROFILES;
      else process.env.SECRETARY_VISION_BUDGET_PROFILES = prior;
    }
  });
