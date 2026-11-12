import { testPostgres } from "../helpers/postgres.ts";
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
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { getInstructions } from "../../../src/pi_secretary/src/instructions.ts";
import { emptySettings } from "../../../src/pi_secretary/src/settings-payload.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import type {
  Consciousness,
  Context,
  SettingsApplication,
} from "../../../src/pi_secretary/src/contracts.ts";
import type { SettingsSource } from "../../../src/pi_secretary/src/settings-memory.ts";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "secretary-settings-"));
function stage(app: App, content = "NEW_STYLE") {
  const draft = app.settings.draft();
  return app.settings.save(
    {
      ...emptySettings(),
      instructions: {
        content,
        expected_revision: getInstructions(app.store).revision,
      },
    },
    draft.revision,
  );
}
async function apply(app: App) {
  const a = app.settings.request(
    app.settings.draft().revision,
    id(),
  ) as SettingsApplication;
  await app.settings.tick();
  return app.store.get<SettingsApplication>("SettingsApplication", a.id);
}
test("draft is durable and inactive; application summarizes both reference sets, rebuilds, and is idempotent", async () => {
  const dir = tmp();
  let app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
  try {
    app.host.accept("Never send external payments.");
    await app.host.drain();
    const old = app.host.session.last_context_id!,
      bytes = app.store.bytes(
        app.store.get<Context>("Context", old).raw_context,
      );
    const cs = app.store.get<Consciousness>(
      "Consciousness",
      app.host.session.consciousness_id,
    );
    app.store.commit([
      revise(cs, {
        pending_raw_refs: [
          ...cs.pending_raw_refs,
          app.store.put([
            {
              role: "user",
              content: "Only in the second pending reference",
              timestamp: 1,
            },
          ]),
        ],
      }),
    ]);
    stage(app);
    assert.equal(getInstructions(app.store).revision, 1);
    await app.close();
    app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
    assert.equal(
      app.settings.status().draft.payload.instructions?.content,
      "NEW_STYLE",
    );
    const revision = app.settings.draft().revision,
      request = id();
    const application = app.settings.request(
      revision,
      request,
    ) as SettingsApplication;
    assert.equal(
      (app.settings.request(revision, request) as SettingsApplication).id,
      application.id,
    );
    await app.settings.tick();
    const result = app.store.get<SettingsApplication>(
      "SettingsApplication",
      application.id,
    );
    assert.equal(result.state, "APPLIED", result.error ?? "");
    assert.equal(getInstructions(app.store).content, "NEW_STYLE");
    assert.notEqual(app.host.session.last_context_id, old);
    assert(
      app.store
        .bytes(app.store.get<Context>("Context", old).raw_context)
        .equals(bytes),
    );
    const source = app.store.read<SettingsSource>(result.source_ref!);
    assert(
      source.chunks.join().includes("Only in the second pending reference"),
    );
    const context = app.store.get<Context>(
      "Context",
      app.host.session.last_context_id!,
    );
    assert.equal(context.settings_application_id, result.id);
    assert.equal(context.instructions_revision, 2);
    assert.equal(context.pending_tool_call_ids.length, 0);
    assert(
      app.store
        .contentText(context.raw_context)
        .includes("Never send external payments"),
    );
    const csNext = app.store.get<Consciousness>("Consciousness", cs.id);
    assert.equal(csNext.pending_raw_refs.length, 0);
    assert.equal(
      (app.settings.request(revision, request) as SettingsApplication).state,
      "APPLIED",
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("summary failure keeps old context/settings and retry preserves draft semantics", async () => {
  const dir = tmp();
  let fail = true;
  const stream: StreamFn = (m, c, o) =>
    c.messages.some(
      (v) =>
        v.role === "system" && contentText(v.content).includes("CONSCIOUSNESS"),
    ) && fail
      ? replyStream([{ type: "text", text: "invalid JSON" }], m)
      : fixtureStream(m, c, o);
  const app = await App.open(dir, { model: fixtureModel, stream });
  try {
    app.host.accept("hello");
    await app.host.drain();
    const old = app.host.session.last_context_id;
    stage(app);
    const a = await apply(app);
    assert.equal(a.state, "FAILED");
    assert.equal(app.host.session.last_context_id, old);
    assert.equal(getInstructions(app.store).revision, 1);
    assert.equal(app.settings.blocked, false);
    fail = false;
    app.settings.retry(a.id);
    await app.settings.tick();
    assert.equal(
      app.store.get<SettingsApplication>("SettingsApplication", a.id).state,
      "APPLIED",
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("new inputs during settings summary queue beyond a fixed boundary; long sources are fully fragmented", async () => {
  const dir = tmp();
  let started!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => (started = r)),
    gate = new Promise<void>((r) => (release = r));
  let count = 0;
  const stream: StreamFn = async (m, c, o) => {
    if (
      c.messages.some(
        (v) =>
          v.role === "system" &&
          contentText(v.content).includes("CONSCIOUSNESS"),
      )
    ) {
      if (++count === 1) {
        started();
        await gate;
      }
    }
    return fixtureStream(m, c, o);
  };
  const app = await App.open(dir, { model: fixtureModel, stream });
  try {
    app.host.accept("old input");
    await app.host.drain();
    const cs = app.store.get<Consciousness>(
      "Consciousness",
      app.host.session.consciousness_id,
    );
    app.store.commit([
      revise(cs, {
        pending_raw_refs: [
          ...cs.pending_raw_refs,
          // Packed summary groups now allow 16KiB. Three complete 11k
          // messages still exercise >=3 groups while each extraction input fits.
          app.store.put(
            Array.from({ length: 3 }, (_, index) => ({
              role: "user",
              content:
                "x".repeat(11000) + (index === 2 ? "END_OF_LONG_SOURCE" : ""),
              timestamp: 10 + index,
            })),
          ),
        ],
      }),
    ]);
    stage(app);
    const a = app.settings.request(
      app.settings.draft().revision,
      id(),
    ) as SettingsApplication;
    await entered;
    const queued = app.host.accept("after boundary");
    await app.host.drain();
    assert.equal(
      app.store.get<import("../../../src/pi_secretary/src/contracts.ts").Input>(
        "Input",
        queued.id,
      ).state,
      "ACCEPTED",
    );
    release();
    await app.settings.tick();
    const done = app.store.get<SettingsApplication>(
      "SettingsApplication",
      a.id,
    );
    assert.equal(done.state, "APPLIED", done.error ?? "");
    assert(count >= 3);
    assert(
      app.store
        .read<SettingsSource>(done.source_ref!)
        .chunks.join()
        .includes("END_OF_LONG_SOURCE"),
    );
    assert.equal(
      app.store.get<import("../../../src/pi_secretary/src/contracts.ts").Input>(
        "Input",
        queued.id,
      ).state,
      "ACCEPTED",
    );
    await app.host.drain();
    assert.equal(
      app.store.get<import("../../../src/pi_secretary/src/contracts.ts").Input>(
        "Input",
        queued.id,
      ).state,
      "HANDLED",
    );
  } finally {
    release();
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("model configuration change after restart must summarize and rebuild before a new turn", async () => {
  const dir = tmp();
  let app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
  try {
    app.host.accept("Remember original constraints.");
    await app.host.drain();
    const old = app.host.session.last_context_id;
    await app.close();
    app = await App.open(dir, {
      model: { ...fixtureModel, id: "fixture-changed-profile" },
      stream: fixtureStream,
    });
    assert(app.settings.blocked);
    const input = app.host.accept("new configuration input");
    await app.host.drain();
    assert.equal(
      app.store.get<import("../../../src/pi_secretary/src/contracts.ts").Input>(
        "Input",
        input.id,
      ).state,
      "ACCEPTED",
    );
    await app.settings.tick();
    const activation = app.settings.applications().at(-1)!;
    assert.equal(activation.state, "APPLIED", activation.error ?? "");
    assert.notEqual(app.host.session.last_context_id, old);
    await app.host.drain();
    assert.equal(app.host.session.state, "IDLE");
    assert.equal(
      app.store.get<Context>("Context", app.host.session.last_context_id!)
        .provider_profile,
      "fixture-changed-profile",
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ordinary compaction with multiple raw references delegates to complete source coverage", async () => {
  const dir = tmp(),
    app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
  try {
    app.host.accept("first");
    await app.host.drain();
    const cs = app.store.get<Consciousness>(
      "Consciousness",
      app.host.session.consciousness_id,
    );
    app.store.commit([
      revise(cs, {
        pending_raw_refs: [
          ...cs.pending_raw_refs,
          app.store.put([
            { role: "user", content: "second reference", timestamp: 1 },
          ]),
        ],
      }),
    ]);
    await app.host.compact();
    const a = app.settings.applications().at(-1)!;
    assert.equal(a.state, "APPLIED", a.error ?? "");
    assert(
      app.store
        .read<SettingsSource>(a.source_ref!)
        .chunks.join()
        .includes("second reference"),
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("failed runtime switch keeps new model blocked until successful summary retry", async () => {
  const dir = tmp();
  let app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
  let fail = true;
  try {
    app.host.accept("preserve this");
    await app.host.drain();
    await app.close();
    const stream: StreamFn = (m, c, o) =>
      fail
        ? replyStream([{ type: "text", text: "invalid summary" }], m)
        : fixtureStream(m, c, o);
    app = await App.open(dir, {
      model: { ...fixtureModel, id: "changed-model-failure" },
      stream,
    });
    await app.settings.tick();
    const a = app.settings.applications().at(-1)!;
    assert.equal(a.state, "FAILED");
    assert(app.settings.blocked);
    const input = app.host.accept("must wait");
    await app.host.drain();
    assert.equal(
      app.store.get<import("../../../src/pi_secretary/src/contracts.ts").Input>(
        "Input",
        input.id,
      ).state,
      "ACCEPTED",
    );
    fail = false;
    app.settings.retry(a.id);
    await app.settings.tick();
    assert.equal(app.settings.blocked, false);
    await app.host.drain();
    assert.equal(app.host.session.state, "IDLE");
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const stage of ["summary-checkpoint", "before-local", "after-local"])
  testPostgres(`SIGKILL at ${stage} is recoverable`, async (dsn) => {
    const { spawn } = await import("node:child_process"),
      { fileURLToPath } = await import("node:url");
    const dir = tmp(),
      entity = id();
    let app: App | undefined;
    try {
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          fileURLToPath(
            new URL("./helpers/settings-crash.ts", import.meta.url),
          ),
          dir,
          entity,
          stage,
        ],
        {
          stdio: "pipe",
          env: { ...process.env, SECRETARY_TEST_DATABASE_URL: dsn },
        },
      );
      let stderr = "";
      child.stderr.on("data", (b) => (stderr += b));
      const signal = await new Promise<string | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (_code, sig) => resolve(sig));
      });
      assert.equal(signal, "SIGKILL", stage + stderr);
      app = await App.open(
        dir,
        { model: fixtureModel, stream: fixtureStream },
        dsn,
      );
      await app.settings.tick();
      const a = app.settings.applications().at(-1)!;
      assert.equal(a.state, "APPLIED", stage + ": " + a.error);
      assert.equal(getInstructions(app.store).revision, 2);
      assert.equal(app.store.all("WorldEntity").length, 2);
      assert.equal(app.settings.applications().length, 1);
    } finally {
      await app?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
