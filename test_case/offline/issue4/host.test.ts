import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentText } from "@earendil-works/pi-ai";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import {
  fixtureModel,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { emptySettings } from "../../../src/pi_secretary/src/settings-payload.ts";
import { getInstructions } from "../../../src/pi_secretary/src/instructions.ts";
import type {
  Consciousness,
  CompactionJob,
  SettingsApplication,
} from "../../../src/pi_secretary/src/contracts.ts";

async function fixture(
  body: (
    app: App,
    counts: { extraction: number; summary: number },
    recover: () => void,
  ) => Promise<void>,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-issue4-host-"));
  const counts = { extraction: 0, summary: 0 };
  let fail = true;
  const stream: StreamFn = (model, context) => {
    const system = contentText(context.messages[0].content);
    let answer = "I will report the synthetic result tomorrow.";
    if (system.includes("COMMITMENT_EXTRACTION:")) {
      counts.extraction++;
      answer = fail
        ? "invalid json"
        : JSON.stringify({
            quotes: ["I will report the synthetic result tomorrow."],
          });
    } else if (system.includes("CONSCIOUSNESS:")) {
      counts.summary++;
      answer = JSON.stringify({
        items: [
          {
            tier: "ACTIVE",
            summary: "Synthetic task",
            goals: [],
            constraints: [],
            decisions: [],
            open_questions: [],
            unfulfilled_commitments: [],
            task_refs: [],
            pending_owner: "MAIN",
          },
        ],
        resolutions: [],
      });
    }
    return replyStream([{ type: "text", text: answer }], model);
  };
  const app = await App.open(dir, { model: fixtureModel, stream });
  try {
    await body(app, counts, () => {
      fail = false;
    });
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const memory = (app: App) =>
  app.store.get<Consciousness>(
    "Consciousness",
    app.host.session.consciousness_id,
  );

test("Host recovery preflight is read-only and commits original compaction without another summary", async () => {
  await fixture(async (app, counts, recover) => {
    app.host.accept("Please report tomorrow.");
    await app.host.drain();
    await app.host.compact();
    const job = app.store.all<CompactionJob>("CompactionJob").at(-1)!;
    assert.equal(job.state, "FAILED");
    const before = app.store.sequence;
    const group = app.host.memoryRecoveryPreflight()[0];
    assert.equal(group.status, "READY");
    assert.equal(app.store.sequence, before);
    const summaryCount = counts.summary;
    recover();
    const request = { request_id: id(), ...group.binding! };
    const result = await app.host.recoverMemory(request);
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(
      app.store.get<CompactionJob>("CompactionJob", job.id).state,
      "COMMITTED",
    );
    assert.equal(memory(app).last_job_id, job.id);
    assert.equal(memory(app).commitments?.[0].source_batch?.owner_id, job.id);
    assert.equal(counts.summary, summaryCount);
    assert.equal(counts.extraction, 2);
    await app.host.recoverMemory(request);
    assert.equal(counts.extraction, 2);
    assert.equal(counts.summary, summaryCount);
  });
});

test("Settings recovery keeps old source and candidate and applies original owner", async () => {
  await fixture(async (app, counts, recover) => {
    app.host.accept("Please report tomorrow.");
    await app.host.drain();
    app.settings.save(
      {
        ...emptySettings(),
        instructions: {
          content: "Synthetic changed instructions",
          expected_revision: getInstructions(app.store).revision,
        },
      },
      app.settings.draft().revision,
    );
    const a = app.settings.request(
      app.settings.draft().revision,
      id(),
    ) as SettingsApplication;
    await app.settings.tick();
    const failed = app.store.get<SettingsApplication>(
      "SettingsApplication",
      a.id,
    );
    assert.equal(failed.state, "FAILED");
    const group = app.host.memoryRecoveryPreflight()[0];
    assert.equal(group.status, "READY");
    const summaries = counts.summary;
    recover();
    const result = await app.host.recoverMemory({
      request_id: id(),
      ...group.binding!,
    });
    assert.equal(result.status, "SUCCEEDED");
    const applied = app.store.get<SettingsApplication>(
      "SettingsApplication",
      a.id,
    );
    assert.equal(applied.state, "APPLIED");
    assert.deepEqual(applied.source_ref, failed.source_ref);
    assert.equal(memory(app).commitments?.[0].source_batch?.owner_id, a.id);
    assert.equal(counts.summary, summaries);
    assert.equal(counts.extraction, 2);
  });
});

test("ordinary settings retry retains failed extraction evidence and never dispatches", async () => {
  await fixture(async (app, counts) => {
    app.host.accept("Please report tomorrow.");
    await app.host.drain();
    app.settings.save(
      {
        ...emptySettings(),
        instructions: {
          content: "Synthetic retry",
          expected_revision: getInstructions(app.store).revision,
        },
      },
      app.settings.draft().revision,
    );
    const a = app.settings.request(
      app.settings.draft().revision,
      id(),
    ) as SettingsApplication;
    await app.settings.tick();
    const before = app.store.get<SettingsApplication>(
      "SettingsApplication",
      a.id,
    );
    const calls = { ...counts };
    const blocked = app.settings.retry(a.id);
    assert.match(blocked.error ?? "", /MEMORY_EXTRACTION_RECOVERY_REQUIRED/);
    await app.settings.tick();
    assert.deepEqual(blocked.source_ref, before.source_ref);
    assert.deepEqual(blocked.candidate_ref, before.candidate_ref);
    assert.equal(blocked.state, "FAILED");
    assert.deepEqual(counts, calls);
    assert.equal(app.host.memoryRecoveryPreflight()[0].status, "READY");
  });
});

test("API v1 recovery shares Host provenance and consumes one bound extraction", async () => {
  const { serveCore } = await import("../../../src/pi_secretary/src/api-v1.ts");
  const { CoreClient } =
    await import("../../../src/pi_secretary/src/core-client.ts");
  const { reconciled } = await import("../issue8/helpers.ts");
  await fixture(async (app, counts, recover) => {
    app.host.accept("Please report tomorrow.");
    await app.host.drain();
    await app.host.compact();
    const backend = await serveCore(app, 0, undefined, { pump: false });
    try {
      const client = new CoreClient(backend.endpoint);
      const groups: any = await client.query("memory/recovery");
      assert.equal(groups.items[0].status, "READY");
      const binding = groups.items[0].binding;
      assert.equal(
        binding.authorization_id,
        app.host.memoryRecoveryPreflight()[0].binding?.authorization_id,
      );
      recover();
      const request = { request_id: id(), ...binding };
      await client.command("memory/recovery", request);
      const result = await reconciled(client, request.request_id);
      assert.equal(result.receipt.state, "COMPLETED");
      assert.equal(result.result.owner_committed, true);
      assert.equal(result.result.status, "SUCCEEDED");
      await client.command("memory/recovery", request);
      assert.equal(counts.extraction, 2);
      assert.equal(
        (await fetch(backend.endpoint.url + "/api/v1/memory/recovery")).status,
        401,
      );
    } finally {
      await backend.close();
    }
  });
});

test("recovery refuses mutated owner boundary even without additional source messages", async () => {
  const { revise } = await import("../../../src/pi_secretary/src/store.ts");
  await fixture(async (app, counts, recover) => {
    app.host.accept("Please report tomorrow.");
    await app.host.drain();
    await app.host.compact();
    const group = app.host.memoryRecoveryPreflight()[0];
    const job = app.store.all<CompactionJob>("CompactionJob").at(-1)!;
    const progress = app.store.read<any>(job.progress_ref!);
    progress.plan.extra.source_end_sequence += 100;
    app.store.commit([
      revise(job, {
        source_end_sequence: job.source_end_sequence! + 100,
        progress_ref: app.store.put(progress),
      }),
    ]);
    recover();
    assert.equal(app.host.memoryRecoveryPreflight()[0].status, "BLOCKED");
    await assert.rejects(
      app.host.recoverMemory({ request_id: id(), ...group.binding! }),
      /FROZEN_OWNER_MISMATCH/,
    );
    assert.equal(counts.extraction, 1);
  });
});
