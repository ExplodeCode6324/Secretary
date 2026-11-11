import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { ApplicationService } from "../../../src/pi_secretary/src/application-service.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
test("owner World command is independent of Settings; preview is read-only; Secretary rename is atomic", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue112-api-"));
  const app = await App.open(dir, {
      model: fixtureModel,
      stream: fixtureStream,
    }),
    api = new ApplicationService(app);
  try {
    const receipt = api.command(api.principal, "world/changes", {
      request_id: id(),
      changes: [
        {
          intent: "ASSERT",
          subject: "role:master",
          predicate: "entity.guideline",
          value: "Use concise replies",
          topic: "communication",
        },
      ],
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(api.receipt(receipt.request_id).state, "ACCEPTED");
    assert.equal(app.store.all("WorldAssertion").length, 1);
    assert.equal(app.store.all("SettingsApplication").length, 0);
    const seq = app.store.sequence,
      preview = api.worldPreview(api.principal, { text: "Master replies" });
    assert.equal(preview.status, "hit");
    assert.equal(app.store.sequence, seq);
    const profile = app.store.all<any>("AssistantProfile")[0];
    api.command(api.principal, "assistant/profile", {
      request_id: id(),
      expected_revision: String(profile.revision),
      name: "Scribe",
    });
    assert.equal(
      app.world!.resolve("role:secretary").entity!.display_name,
      "Scribe",
    );
    assert.throws(
      () =>
        app.settings.save(
          {
            instructions: null,
            edits: [
              {
                kind: "ENTITY",
                entity_id: id(),
                entity_kind: "PERSON",
                display_name: "Invalid Settings",
                expected_revision: 0,
              },
            ],
            command_ids: [],
          },
          app.settings.draft().revision,
        ),
      /WORLD_USE_WORLD_CHANGES_API/,
    );
  } finally {
    await api.close();
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
