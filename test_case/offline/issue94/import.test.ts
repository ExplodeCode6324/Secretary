import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
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
import { LocalFiles } from "../../../src/pi_secretary/src/tui/state.ts";
import { Delivery } from "../../../src/pi_secretary/src/tui/delivery.ts";
import {
  ImageImports,
  requireImageCapability,
} from "../../../src/pi_secretary/src/tui/image-import.ts";
import { messageComponent } from "../../../src/pi_secretary/src/tui/view.ts";
import type { Message } from "../../../src/pi_secretary/src/api/contracts.ts";

test("real Core import survives lost receipt/local restart; immutable image send survives accepted POST response loss", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "issue94-import-"));
  const prior = process.env.SECRETARY_VISION_BUDGET_PROFILES;
  const model = {
    ...fixtureModel,
    input: ["text", "image"] as ("text" | "image")[],
    contextWindow: 128000,
  };
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
      source: "Synthetic fixture only",
    },
  ]);
  const app = await App.open(path.join(root, "core"), {
      model,
      stream: fixtureStream,
    }),
    server = await serveCore(app, 0, undefined, { pump: false }),
    client = new CoreClient(server.endpoint);
  let files = new LocalFiles(path.join(root, "tui"));
  try {
    const core = await client.core();
    let state = await files.open(core.data_domain_id, core.mode);
    let delivery = new Delivery(state, files);
    await delivery.connect(client);
    const original = client.command.bind(client);
    let loseImport = true;
    client.command = async (route, body) => {
      const receipt = await original(route, body);
      if (route === "attachments/import" && loseImport) {
        loseImport = false;
        throw Error("LOST_IMPORT_RESPONSE");
      }
      return receipt;
    };
    const imports = new ImageImports(delivery, files),
      m = await imports.begin();
    const bytes = await sharp({
      create: { width: 20, height: 12, channels: 3, background: "blue" },
    })
      .png()
      .toBuffer();
    await imports.captured(m, bytes, await requireImageCapability(client));
    assert.equal(m.status, "UNKNOWN");
    const frozen = structuredClone(m.body);
    assert(frozen);
    await server.service.attachmentImports.settle();
    await delivery.close();
    await files.close();
    files = new LocalFiles(path.join(root, "tui"));
    state = await files.open(core.data_domain_id, core.mode);
    delivery = new Delivery(state, files);
    await delivery.connect(client);
    const recovered = new ImageImports(delivery, files);
    await recovered.reconcile();
    assert.deepEqual(state.drafts.Main.materials![0].body, frozen);
    assert.equal(state.drafts.Main.materials![0].status, "READY");
    assert.equal(app.store.all("Attachment").length, 1);
    const source = await fs.readFile(frozen.source_path);
    assert.deepEqual(source, bytes);
    delivery.edit("Main", "caption");
    client.command = async (route, body) => {
      const receipt = await original(route, body);
      if (route === "messages") throw Error("LOST_MESSAGE_RESPONSE");
      return receipt;
    };
    await delivery.submit("caption", "caption");
    await delivery.reconcile();
    assert.equal(app.store.all("Input").length, 1);
    assert.equal(state.pending, undefined);
    assert.equal(state.drafts.Main.materials?.length ?? 0, 0);
    delivery.edit("Main", "new typed caption");
    const failures = new ImageImports(delivery, files),
      bad = await failures.begin(),
      cap = await requireImageCapability(client);
    delivery.client = undefined;
    await failures.captured(bad, bytes, cap);
    bad.body!.expected_sha256 = "0".repeat(64);
    await delivery.flush();
    delivery.client = client;
    await failures.reconcile();
    await server.service.attachmentImports.settle();
    await failures.reconcile();
    assert.equal(bad.status, "FAILED");
    assert.equal(state.drafts.Main.raw, "new typed caption");
    assert.deepEqual(await fs.readFile(bad.body!.source_path), bytes);
    await delivery.submit(state.drafts.Main.raw, state.drafts.Main.raw);
    assert.equal(app.store.all("Input").length, 1);
    await delivery.close();
  } finally {
    await files.close();
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
    if (prior === undefined)
      delete process.env.SECRETARY_VISION_BUDGET_PROFILES;
    else process.env.SECRETARY_VISION_BUDGET_PROFILES = prior;
  }
});
test("artifact tail exposes bidi and model provenance only after the actual body end", () => {
  const m = {
    id: "m",
    role: "assistant",
    kind: "message",
    text: "body",
    revision: "1",
    call_id: null,
    incomplete: false,
    next_cursor: null,
    delivery_count: 1,
    outcome: "truncated",
  } as Message;
  const tail: any = {
    items: [
      {
        name: "report",
        task_id: "task",
        execution_id: "exec",
        current_path: "/x/\u202Ereport.txt",
        current_state: "available",
        description: "meaning",
        state: "available",
        content_version: "hash",
      },
    ],
    total: 1,
    next_cursor: null,
    previous: [],
    cursor: null,
  };
  const lines = messageComponent(
    m,
    false,
    undefined,
    false,
    "Secretary",
    undefined,
    tail,
  )
    .render(120)
    .join("\n");
  assert(lines.includes("NOT_VERIFIED"));
  assert(lines.includes("\\u{202E}"));
  assert(lines.includes("truncated"));
  assert(!lines.includes("\u202E"));
  const partial = messageComponent(
    { ...m, next_cursor: "more" },
    false,
    undefined,
    false,
    "Secretary",
    undefined,
    tail,
  )
    .render(120)
    .join("\n");
  assert(!partial.includes("NOT_VERIFIED"));
});
