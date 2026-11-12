import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentText } from "@earendil-works/pi-ai";
import { testPostgres } from "../helpers/postgres.ts";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { emptySettings } from "../../../src/pi_secretary/src/settings-payload.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import type { SettingsApplication } from "../../../src/pi_secretary/src/contracts.ts";
testPostgres(
  "extraction failure does not block World Settings; retry and reopen retain the single World receipt",
  async (dsn) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-issue19-pg-"));
    let fail = true;
    const stream: StreamFn = (m, c, o) =>
      c.messages.some(
        (v) =>
          v.role === "system" &&
          contentText(v.content).includes("COMMITMENT_EXTRACTION:"),
      )
        ? replyStream(
            [{ type: "text", text: fail ? "invalid JSON" : '{"quotes":[]}' }],
            m,
          )
        : fixtureStream(m, c, o);
    let app = await App.open(dir, { model: fixtureModel, stream }, dsn);
    try {
      await app.world!.migrate();
      app.host.accept("Synthetic source to preserve across settings failure.");
      await app.host.drain();
      const entity = id();
      app.settings.save(
        {
          ...emptySettings(),
          edits: [
            {
              kind: "ENTITY",
              entity_id: entity,
              entity_kind: "PERSON",
              display_name: "Synthetic retry person",
              expected_revision: 0,
            },
            {
              kind: "FACT",
              mode: "ASSERT",
              subject_id: entity,
              predicate_key: "person.display_name",
              scope_key: "",
              expected_revision: 0,
              value: "Stable",
            },
          ],
        },
        app.settings.draft().revision,
      );
      const request = app.settings.request(
        app.settings.draft().revision,
        id(),
      ) as SettingsApplication;
      await app.settings.tick();
      assert.equal(
        app.store.get<SettingsApplication>("SettingsApplication", request.id)
          .state,
        "APPLIED",
      );
      assert(
        app.host.memoryStatus().extraction.some((j) => j.state === "FAILED"),
      );
      const receipt = await app.world!.batchReceipt(request.id);
      assert(receipt);
      const before = (await app.world!.browse({ subject: entity })).rows;
      assert.equal(before.length, 1);
      assert.equal(before[0].value, "Stable");
      await app.close();
      app = await App.open(dir, { model: fixtureModel, stream }, dsn);
      fail = false;
      app.host.retryExtractions(id());
      await app.host.extractPending();
      app.settings.retry(request.id);
      await app.settings.tick();
      assert.deepEqual(await app.world!.batchReceipt(request.id), receipt);
      assert.deepEqual(
        (await app.world!.browse({ subject: entity })).rows,
        before,
      );
      assert.equal(app.host.memoryStatus().extraction.length, 0);
    } finally {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
