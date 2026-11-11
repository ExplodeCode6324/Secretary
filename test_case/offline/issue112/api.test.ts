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

test("HTTP approval details expose live evidence and conflicts; Main batch status and owner-only preview use the public routes", async () => {
  const { serveCore } = await import("../../../src/pi_secretary/src/api-v1.ts");
  const { CoreClient } =
    await import("../../../src/pi_secretary/src/core-client.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue112-http-"));
  const app = await App.open(dir, {
      model: fixtureModel,
      stream: fixtureStream,
    }),
    server = await serveCore(app, 0),
    client = new CoreClient(server.endpoint);
  try {
    await client.command("world/changes", {
      request_id: id(),
      changes: [
        {
          intent: "ASSERT",
          subject: "role:master",
          predicate: "entity.guideline",
          topic: "communication",
          value: "Use concise English",
        },
      ],
    });
    app.host.accept(
      "Synthetic Master: add the alias Owner and use detailed Chinese",
    );
    const ev = app.store.events("input.accepted").at(-1)!.event_id,
      batchID = id(),
      proposal = app.world!.propose(
        {
          version: 1,
          batch_id: batchID,
          changes: [
            {
              intent: "EDIT_ENTITY",
              subject: "role:master",
              aliases: { add: ["Owner"] },
              source_event_ids: [ev],
            },
            {
              intent: "ASSERT",
              subject: "role:master",
              predicate: "entity.guideline",
              topic: "communication",
              value: "Use detailed Chinese",
              source_event_ids: [ev],
            },
          ],
        },
        { session_id: app.host.sessionID, task_id: null, execution_id: null },
      );
    const detail: any = await client.query(
      "authorizations/" + proposal.authorization_id,
    );
    assert(detail.display.world_preview.preview_at);
    assert.match(
      JSON.stringify(detail.display.world_preview.evidence),
      /Synthetic Master/,
    );
    assert.equal(detail.display.world_preview.existing_live.length, 1);
    assert.equal(
      detail.display.world_preview.conflicts[0].status,
      "POSSIBLY-CONFLICTING",
    );
    await client.command(
      "authorizations/" + proposal.authorization_id + "/decision",
      {
        request_id: id(),
        expected_revision: detail.revision,
        display_hash: detail.display_hash,
        decision: "APPROVE",
      },
    );
    await app.world!.drain();
    const status: any = await client.query("world/batches/" + batchID);
    assert.equal(status.status, "COMMITTED");
    assert.equal(app.store.all("Input").length, 1);
    assert.equal(app.store.all("SettingsApplication").length, 0);
    await app.host.drain();
    const sequence = app.store.sequence;
    const response = await fetch(
      server.endpoint.url + "/api/v1/world/preview",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + server.endpoint.token,
          "Content-Type": "application/json",
          "X-Secretary-API-Version": "1",
        },
        body: JSON.stringify({ text: "Master instructions" }),
      },
    );
    assert.equal(response.status, 200);
    const body: any = await response.json();
    assert.equal(body.data.status, "hit");
    assert.equal(app.store.sequence, sequence);
    const anonymous = await fetch(
      server.endpoint.url + "/api/v1/world/preview",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Secretary-API-Version": "1",
        },
        body: JSON.stringify({ text: "Master" }),
      },
    );
    assert.equal(anonymous.status, 401);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
