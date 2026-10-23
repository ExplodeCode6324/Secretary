import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../../src/pi_secretary/src/api-v1.ts";
import { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import { hash, id } from "../../../src/pi_secretary/src/store.ts";
import { validate } from "../../../src/pi_secretary/src/api/protocol.ts";
import type {
  Attachment,
  Input,
} from "../../../src/pi_secretary/src/contracts.ts";
test("authenticated API transfers binary, preserves async receipt, redacts projections and marks withdrawal", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue81-api-")),
    model = {
      ...fixtureModel,
      input: ["text", "image"] as ("text" | "image")[],
      contextWindow: 128000,
    },
    prior = process.env.SECRETARY_VISION_BUDGET_PROFILES;
  process.env.SECRETARY_VISION_BUDGET_PROFILES = JSON.stringify([
    {
      version: 1,
      provider: model.provider,
      api: model.api,
      model: model.id,
      baseUrl: model.baseUrl,
      tokens_per_image: 8192,
      max_side: 4096,
      max_pixels: 4194304,
      source: "Synthetic test only",
    },
  ]);
  const app = await App.open(dir, { model, stream: fixtureStream }),
    server = await serveCore(app, 0, undefined, { pump: false }),
    client = new CoreClient(server.endpoint);
  try {
    const core = await client.core();
    validate("Core", core);
    assert.equal(core.capabilities.attachments.allowed, true);
    const cursor = (await client.syncCursor()).cursor;
    const bytes = await sharp({
        create: { width: 16, height: 16, channels: 3, background: "red" },
      })
        .jpeg()
        .toBuffer(),
      file = path.join(dir, "private source.jpeg"),
      request = id();
    fs.writeFileSync(file, bytes);
    const receipt = await client.command("attachments/import", {
      request_id: request,
      source_path: file,
      expected_sha256: hash(bytes),
      expected_bytes: String(bytes.length),
      name: "显示 '图.jpeg",
    });
    validate("Receipt", receipt);
    await server.service.attachmentImports.settle();
    const result: any = await client.query(`requests/${request}`);
    assert.equal(result.receipt.state, "COMPLETED");
    const attachmentID = result.result.attachment_id;
    validate("AttachmentMetadata", result.result);
    fs.unlinkSync(file);
    assert.deepEqual(await client.attachmentContent(attachmentID), bytes);
    const raw = await fetch(
      `${server.endpoint.url}/api/v1/attachments/${attachmentID}/content`,
      { headers: { Authorization: `Bearer ${server.endpoint.token}` } },
    );
    assert.equal(raw.headers.get("content-type"), "application/octet-stream");
    assert.equal(raw.headers.get("etag"), `"${hash(bytes)}"`);
    assert.equal(raw.headers.get("x-content-type-options"), "nosniff");
    assert.equal(Number(raw.headers.get("content-length")), bytes.length);
    await raw.arrayBuffer();
    assert.equal(
      (
        await fetch(
          `${server.endpoint.url}/api/v1/attachments/${attachmentID}/content`,
        )
      ).status,
      401,
    );
    const send = await client.command("messages", {
      request_id: id(),
      text: "",
      attachment_ids: [attachmentID],
    });
    const inputID = send.resource_ids.find((r) => r.type === "Input")!.id;
    let imageReads = 0;
    const readBytes = app.store.bytes.bind(app.store);
    app.store.bytes = (ref) => {
      if (ref.sha256 === hash(bytes)) imageReads++;
      return readBytes(ref);
    };
    const timeline: any = await client.query("timeline"),
      row = timeline.items.find((r: any) => r.input_id === inputID);
    app.store.bytes = readBytes;
    assert.equal(
      imageReads,
      0,
      "timeline availability must not hash every image binary",
    );
    assert.ok(row);
    validate("Message", row);
    assert.equal(row.text, "");
    assert.equal((row.attachments as unknown[]).length, 1);
    const detail: any = await client.query(
      `messages/${encodeURIComponent(String(row.id))}/content`,
    );
    assert.equal(detail.attachments[0].sha256, hash(bytes));
    const input = app.store.get<Input>("Input", inputID);
    await client.command(`inputs/${inputID}/withdraw`, {
      request_id: id(),
      expected_revision: String(input.revision),
    });
    const after: any = await client.query("timeline");
    assert.equal(
      after.items.find((r: any) => r.input_id === inputID).withdrawn,
      true,
    );
    const changes = await client.changes(cursor);
    const publicJSON = JSON.stringify([result, after, changes]);
    assert.ok(!publicJSON.includes(file));
    assert.ok(!publicJSON.includes(bytes.toString("base64")));
    assert.ok(!publicJSON.includes('"path":"objects/'));
    await assert.rejects(
      client.command("messages", { request_id: request, text: "conflict" }),
      /REQUEST_CONFLICT/,
    );
    const a = app.store.get<Attachment>("Attachment", attachmentID);
    fs.writeFileSync(
      path.join(app.store.dir, a.content.path),
      Buffer.alloc(bytes.length),
    );
    assert.equal(
      (await client.query<any>(`attachments/${attachmentID}`)).availability,
      "unavailable",
    );
    await assert.rejects(
      client.attachmentContent(attachmentID),
      /ATTACHMENT_UNAVAILABLE/,
    );
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
    if (prior === undefined)
      delete process.env.SECRETARY_VISION_BUDGET_PROFILES;
    else process.env.SECRETARY_VISION_BUDGET_PROFILES = prior;
  }
});
