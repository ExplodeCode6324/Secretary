import sharp from "sharp";
import { ApplicationService } from "../../../src/pi_secretary/src/application-service.ts";
import { hash } from "../../../src/pi_secretary/src/store.ts";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import { contentText } from "@earendil-works/pi-ai";
import type {
  MainPromptSnapshot,
  AuthorizationRequest,
  Input,
  WorldAssertion,
} from "../../../src/pi_secretary/src/contracts.ts";
import {
  worldSnapshot,
  recall,
} from "../../../src/pi_secretary/src/world-recall.ts";
const opts = { model: fixtureModel, stream: fixtureStream };
const scope = (app: App) => ({
  session_id: app.host.sessionID,
  task_id: null,
  execution_id: null,
});
const ownerFact = (app: App, value: string) =>
  app.world!.ownerChange(
    {
      version: 1,
      batch_id: id(),
      changes: [
        {
          intent: "ASSERT",
          subject: "role:master",
          predicate: "entity.guideline",
          topic: "communication",
          value,
        },
      ],
    },
    scope(app),
  );
test("Main CLAIMED frame freezes profile and recall; later World writes affect only the next loop and survive restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue112-snapshot-"));
  let app: App;
  let changed = false;
  const seen: string[] = [];
  const stream: StreamFn = (m, c, o) => {
    const sys = contentText(c.messages[0].content);
    if (!/CONSCIOUSNESS:|COMMITMENT_EXTRACTION:/.test(sys)) {
      seen.push(sys);
      const snapshots = app.store.all<MainPromptSnapshot>("MainPromptSnapshot");
      assert(snapshots.at(-1)?.recall_ref);
      if (!changed) {
        changed = true;
        ownerFact(app, "Later direction: use explicit examples");
      }
    }
    return fixtureStream(m, c, o);
  };
  app = await App.open(dir, { model: fixtureModel, stream });
  try {
    ownerFact(app, "Initial direction: be concise");
    app.host.accept("Synthetic greeting");
    await app.host.drain();
    assert(seen.length);
    assert.match(seen[0], /Initial direction/);
    assert(!seen[0].includes("Later direction"));
    const old = app.store
      .all<MainPromptSnapshot>("MainPromptSnapshot")
      .find((s) =>
        contentText(app.store.read<any>(s.system_message).content).includes(
          "Initial direction",
        ),
      )!;
    const frozen = app.store.bytes(old.system_message);
    const recallRef = old.recall_ref!;
    assert(
      app.store.projectionFrames.some(
        (f) =>
          f.mutations.some(
            (m) =>
              m.object_type === "MainPromptSnapshot" && m.object_id === old.id,
          ) && f.mutations.some((m) => m.object_type === "Input"),
      ),
    );
    await app.close();
    app = await App.open(dir, opts);
    assert.deepEqual(app.store.bytes(old.system_message), frozen);
    assert.deepEqual(
      app.store.get<MainPromptSnapshot>("MainPromptSnapshot", old.id)
        .recall_ref,
      recallRef,
    );
    app.host.accept("Synthetic next turn");
    await app.host.drain();
    const next = app.store
      .all<MainPromptSnapshot>("MainPromptSnapshot")
      .at(-1)!;
    assert.match(
      contentText(app.store.read<any>(next.system_message).content),
      /Later direction/,
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
for (const mode of ["before", "after"])
  test(
    "SIGKILL " + mode + " journal_apply replays one whole batch exactly once",
    async () => {
      const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), "issue112-apply-crash-"),
      );
      let app = await App.open(dir, opts);
      try {
        app.host.accept("Synthetic Master preference: tea");
        const ev = app.store.events("input.accepted").at(-1)!.event_id,
          batch = {
            version: 1 as const,
            batch_id: id(),
            changes: [
              {
                intent: "ASSERT" as const,
                subject: "role:master",
                predicate: "preference.statement",
                value: "Tea",
                source_event_ids: [ev],
              },
            ],
          };
        const p = app.world!.propose(batch, scope(app));
        const a = app.store.get<AuthorizationRequest>(
          "AuthorizationRequest",
          p.authorization_id!,
        );
        app.authorization.decide({
          schema_version: 1,
          record_type: "ApprovalCommand",
          request_id: id(),
          authorization_id: a.id,
          expected_revision: a.revision,
          display_hash: a.display_hash,
          decision: "APPROVE",
        });
        await app.close();
        const child = spawnSync(
          process.execPath,
          [
            "--import",
            "tsx",
            fileURLToPath(new URL("./workers/crash.ts", import.meta.url)),
            dir,
            mode,
          ],
          { encoding: "utf8", timeout: 20000 },
        );
        assert.equal(child.signal, "SIGKILL", child.stderr);
        app = await App.open(dir, opts);
        assert.equal(
          app.store.all("WorldAssertion").length,
          mode === "after" ? 1 : 0,
        );
        await app.world!.drain();
        assert.equal(
          app.world!.batch(batch.batch_id, app.host.sessionID).status,
          "COMMITTED",
        );
        assert.equal(app.store.all("WorldAssertion").length, 1);
        assert.equal(app.store.events("operation.journal_applied").length, 1);
        assert.equal(
          app.store.get<AuthorizationRequest>("AuthorizationRequest", a.id)
            .state,
          "CONSUMED",
        );
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
test("withdrawn evidence disappears from live recall while explicit history retains its provenance", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue112-withdraw-"));
  const visionModel = {
    ...fixtureModel,
    input: ["text", "image"] as ("text" | "image")[],
  };
  const previous = process.env.SECRETARY_VISION_BUDGET_PROFILES;
  process.env.SECRETARY_VISION_BUDGET_PROFILES = JSON.stringify([
    {
      version: 1,
      provider: visionModel.provider,
      api: visionModel.api,
      model: visionModel.id,
      baseUrl: visionModel.baseUrl,
      tokens_per_image: 8192,
      max_side: 4096,
      max_pixels: 4194304,
      source: "Synthetic test",
    },
  ]);
  const app = await App.open(dir, {
    model: visionModel,
    stream: fixtureStream,
  });
  try {
    const service = new ApplicationService(app);
    const bytes = await sharp({
        create: { width: 16, height: 16, channels: 3, background: "red" },
      })
        .png()
        .toBuffer(),
      file = path.join(dir, "image.png"),
      request = id();
    fs.writeFileSync(file, bytes);
    service.command(service.principal, "attachments/import", {
      request_id: request,
      source_path: file,
      expected_sha256: hash(bytes),
      expected_bytes: String(bytes.length),
      name: "image.png",
    });
    await service.attachmentImports.settle();
    const attachment = app.store.get<any>(
      "AttachmentImport",
      request,
    ).attachment_id;
    const input = app.host.accept(
      "Synthetic Master preference: cinnamon tea",
      id(),
      "MASTER",
      [attachment],
    );
    const ev = app.store.events("input.accepted").at(-1)!.event_id,
      p = app.world!.propose(
        {
          version: 1,
          batch_id: id(),
          changes: [
            {
              intent: "ASSERT",
              subject: "role:master",
              predicate: "preference.statement",
              value: "Cinnamon tea",
              source_event_ids: [ev],
            },
          ],
        },
        scope(app),
      ),
      a = app.store.get<AuthorizationRequest>(
        "AuthorizationRequest",
        p.authorization_id!,
      );
    app.authorization.decide({
      schema_version: 1,
      record_type: "ApprovalCommand",
      request_id: id(),
      authorization_id: a.id,
      expected_revision: a.revision,
      display_hash: a.display_hash,
      decision: "APPROVE",
    });
    await app.world!.drain();
    const at = new Date().toISOString();
    assert.equal(
      recall(worldSnapshot(app.store, at), "cinnamon", {}, at).status,
      "hit",
    );
    service.command(service.principal, `inputs/${input.id}/withdraw`, {
      request_id: id(),
      expected_revision: String(input.revision),
    });
    assert.equal(
      recall(worldSnapshot(app.store, at), "cinnamon", {}, at).status,
      "no_hit",
    );
    assert.equal(
      (await app.world!.browse({ history: true })).rows[0].evidence_status,
      "EVIDENCE_WITHDRAWN",
    );
    await service.close();
  } finally {
    if (previous === undefined)
      delete process.env.SECRETARY_VISION_BUDGET_PROFILES;
    else process.env.SECRETARY_VISION_BUDGET_PROFILES = previous;
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
