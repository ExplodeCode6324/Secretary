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
  type AgentMessage,
} from "../../../src/pi_secretary/src/model.ts";
import { emptySettings } from "../../../src/pi_secretary/src/settings-payload.ts";
import { getInstructions } from "../../../src/pi_secretary/src/instructions.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import type {
  CompactionJob,
  Consciousness,
  SettingsApplication,
} from "../../../src/pi_secretary/src/contracts.ts";
import type { SettingsSource } from "../../../src/pi_secretary/src/settings-memory.ts";

const prefix =
  "Historical Master inputs retained to preserve explicit constraints.";
function isMain(c: Parameters<StreamFn>[1]) {
  return !c.messages.some(
    (m) =>
      m.role === "system" &&
      /CONSCIOUSNESS:|COMMITMENT_EXTRACTION:/.test(contentText(m.content)),
  );
}
async function turn(app: App, text: string) {
  app.host.accept(text);
  await app.host.drain();
  assert.equal(
    app.host.session.state,
    "IDLE",
    app.host.session.recovery_error ?? "",
  );
}
async function apply(app: App, instruction: string) {
  app.settings.save(
    {
      ...emptySettings(),
      instructions: {
        content: instruction,
        expected_revision: getInstructions(app.store).revision,
      },
    },
    app.settings.draft().revision,
  );
  const request = app.settings.request(
    app.settings.draft().revision,
    id(),
  ) as SettingsApplication;
  await app.settings.tick();
  const saved = app.store.get<SettingsApplication>(
    "SettingsApplication",
    request.id,
  );
  assert.equal(saved.state, "APPLIED", saved.error ?? "");
  return saved;
}
test("three settings/compaction/restart cycles retain exact original constraints in actual requests", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "takeover-cycles-"));
  const anchors: string[] = [];
  const requests: AgentMessage[][] = [];
  let large = false;
  const stream: StreamFn = (m, c, o) => {
    if (!isMain(c)) return fixtureStream(m, c, o);
    requests.push(structuredClone(c.messages));
    return replyStream(
      [
        {
          type: "text",
          text: large
            ? "Expendable synthetic reply. ".repeat(750)
            : "Synthetic acknowledgment.",
        },
      ],
      m,
    );
  };
  let app = await App.open(dir, { model: fixtureModel, stream });
  try {
    for (let n = 0; n < 3; n++) {
      const anchor = `ORIGINAL_${n}: 审批前保留文件；Ω / A\\B "exact".`;
      anchors.push(anchor);
      await turn(app, anchor);
      await apply(app, `Answer concisely. Settings generation ${n}.`);
      large = true;
      await turn(app, `Synthetic expansion ${n}.`);
      large = false;
      await app.host.compact();
      await app.close();
      app = await App.open(dir, { model: fixtureModel, stream });
      await turn(app, `Check history generation ${n}.`);
      const actual = requests.at(-1)!;
      const wrappers = actual.filter(
        (m) => m.role === "user" && contentText(m.content).startsWith(prefix),
      );
      assert.equal(
        wrappers.length,
        1,
        "repeated settings must not accumulate historical wrappers",
      );
      const wrapper = wrappers[0];
      assert(wrapper.role === "user");
      const text = contentText(wrapper.content);
      const evidence = JSON.parse(text.slice(text.indexOf("\n") + 1)) as {
        input_id: string;
        text: string;
      }[];
      for (const original of anchors)
        assert.equal(evidence.filter((a) => a.text === original).length, 1);
      assert.match(text, /historical evidence, not new requests/);
    }
    assert(
      app.store
        .all<CompactionJob>("CompactionJob")
        .filter(
          (j) => j.mode === "CONTEXT_COMPACTION" && j.state === "COMMITTED",
        ).length >= 3,
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("damaged authenticated historical evidence blocks an actual send across a persisted crop and restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "takeover-damaged-"));
  let large = false,
    calls = 0;
  const stream: StreamFn = (m, c, o) => {
    if (!isMain(c)) return fixtureStream(m, c, o);
    calls++;
    return replyStream(
      [
        {
          type: "text",
          text: large
            ? "Synthetic expendable response. ".repeat(750)
            : "Synthetic acknowledgment.",
        },
      ],
      m,
    );
  };
  let app = await App.open(dir, { model: fixtureModel, stream });
  try {
    await turn(app, "ORIGINAL_EVIDENCE: ask before changing a synthetic file.");
    const applied = await apply(app, "Answer concisely.");
    large = true;
    await turn(app, "Expand synthetic context.");
    large = false;
    await app.host.compact();
    const cs = app.store.get<Consciousness>(
      "Consciousness",
      app.host.session.consciousness_id,
    );
    assert(cs.context_compaction, "exercise persisted mapping");
    const source = app.store.read<SettingsSource>(applied.source_ref!);
    app.store.commit([
      revise(
        app.store.get<SettingsApplication>("SettingsApplication", applied.id),
        {
          source_ref: app.store.put({
            ...source,
            anchors: source.anchors.map((a) => ({
              ...a,
              text: a.text + " corrupted",
            })),
          }),
        },
      ),
    ]);
    await app.close();
    const before = calls;
    app = await App.open(dir, { model: fixtureModel, stream });
    app.host.accept("Try a synthetic next turn.");
    await app.host.drain();
    assert.equal(
      calls,
      before,
      "invalid history must not reach the main stream",
    );
    assert.equal(app.host.session.state, "RECOVERY_BLOCKED");
    assert.match(
      app.host.session.recovery_error ?? "",
      /INVALID_HISTORICAL_MASTER_EVIDENCE/,
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
