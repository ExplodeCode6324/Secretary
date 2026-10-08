import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  replyStream,
  type AgentMessage,
} from "../../../src/pi_secretary/src/model.ts";
import {
  settingsSource,
  summarizeSettings,
  type SettingsSource,
} from "../../../src/pi_secretary/src/settings-memory.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";

for (const corruption of ["pre-v2", "wrong-last-evidence"] as const) {
  test(`settings rejects ${corruption} source before any model call`, async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "issue3-settings-evidence-"),
    );
    let calls = 0;
    const app = await App.open(dir, {
      model: fixtureModel,
      stream: (model) => {
        calls++;
        return replyStream(
          [
            {
              type: "text",
              text: "Synthetic response without external actions.",
            },
          ],
          model,
        );
      },
    });
    try {
      app.host.accept("Synthetic source validation request.");
      await app.host.drain();
      const source = settingsSource(app.host, {
        world: [],
        instructions: null,
      });
      const before = calls;
      let invalid: SettingsSource;
      if (corruption === "pre-v2") {
        const legacy: Partial<SettingsSource> = { ...source };
        delete legacy.plan;
        delete legacy.extraction_messages;
        invalid = legacy as SettingsSource;
      } else {
        const messages = app.store.read<AgentMessage[]>(source.refs.at(-1)!);
        const altered = messages.map((message) => ({
          ...message,
          timestamp: message.timestamp + 1,
        }));
        invalid = {
          ...source,
          refs: [...source.refs.slice(0, -1), app.store.put(altered)],
        };
      }
      await assert.rejects(
        summarizeSettings(app.host, id(), invalid, null, () => {}),
        corruption === "pre-v2"
          ? /SETTINGS_SOURCE_UPGRADE_REQUIRED/
          : /INVALID_SETTINGS_EXTRACTION_EVIDENCE/,
      );
      assert.equal(
        calls,
        before,
        "invalid frozen source must not start a summary or extraction request",
      );
    } finally {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
