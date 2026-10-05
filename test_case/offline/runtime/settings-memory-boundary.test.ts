import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentText } from "@earendil-works/pi-ai";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { getInstructions } from "../../../src/pi_secretary/src/instructions.ts";
import {
  emptySettings,
  type SettingsPayload,
} from "../../../src/pi_secretary/src/settings-payload.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import type {
  Context,
  SettingsApplication,
} from "../../../src/pi_secretary/src/contracts.ts";

test("settings CAS revision remains durable but cannot masquerade as the model's active revision", async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "secretary-settings-boundary-"),
  );
  const packets: { settings_changes: { instructions: unknown } }[] = [];
  const stream: StreamFn = (model, context, options) => {
    for (const message of context.messages) {
      if (message.role !== "user") continue;
      try {
        const packet = JSON.parse(contentText(message.content));
        if (packet.settings_changes) packets.push(packet);
      } catch {
        /* ordinary conversation text */
      }
    }
    return fixtureStream(model, context, options);
  };
  const app = await App.open(dir, { model: fixtureModel, stream });
  try {
    app.host.accept(
      "Synthetic constraint: use no tools only when existing evidence is sufficient.",
    );
    await app.host.drain();
    const before = getInstructions(app.store).revision;
    const content = "Always answer in English.";
    app.settings.save(
      {
        ...emptySettings(),
        instructions: { content, expected_revision: before },
      },
      app.settings.draft().revision,
    );
    const request = app.settings.request(
      app.settings.draft().revision,
      id(),
    ) as SettingsApplication;
    await app.settings.tick();
    const application = app.store.get<SettingsApplication>(
      "SettingsApplication",
      request.id,
    );
    assert.equal(application.state, "APPLIED", application.error ?? "");
    assert.equal(
      app.store.read<SettingsPayload>(application.payload_ref).instructions
        ?.expected_revision,
      before,
    );
    assert.equal(getInstructions(app.store).revision, before + 1);
    assert(packets.length > 0, "must exercise actual settings summary request");
    for (const packet of packets)
      assert.deepEqual(packet.settings_changes.instructions, { content });
    const context = app.store.get<Context>("Context", application.context_id!);
    assert.equal(context.instructions_revision, before + 1);
    const raw = app.store.bytes(context.raw_context).toString();
    assert(
      !raw.includes("expected_revision"),
      "model activation record must not expose the old CAS revision",
    );
    assert(
      raw.includes("existing evidence is sufficient"),
      "original conditional constraint remains anchored",
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
