import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contentText } from "@earendil-works/pi-ai";
import { App } from "../../../../src/pi_secretary/src/app.ts";
import { id } from "../../../../src/pi_secretary/src/store.ts";
import {
  fixtureModel,
  replyStream,
  type StreamFn,
} from "../../../../src/pi_secretary/src/model.ts";
import type {
  Consciousness,
  CompactionJob,
  ExtractionRecovery,
  ModelCall,
} from "../../../../src/pi_secretary/src/contracts.ts";
import type { RecoveryRequest } from "../../../../src/pi_secretary/src/memory-extraction-recovery.ts";

const [mode, directory, boundary] = process.argv.slice(2);
const evidenceRoot = fileURLToPath(
  new URL("../../../reports/issue4-20261006/crash/", import.meta.url),
);
assert.ok(
  directory &&
    path.resolve(directory).startsWith(path.resolve(evidenceRoot) + path.sep),
  "test store must be inside issue4 crash evidence",
);
assert.ok(
  fs
    .realpathSync(directory)
    .startsWith(fs.realpathSync(evidenceRoot) + path.sep),
  "no symlink escape",
);
const file = (name: string) => path.join(directory, name);
function durableJSON(name: string, value: unknown) {
  const staged = file(name + ".tmp");
  const fd = fs.openSync(staged, "w", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // Publish only after the complete marker is flushed; existsSync in the parent
  // must never observe the empty/partial file created by open("w").
  fs.renameSync(staged, file(name));
  const directoryFD = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(directoryFD);
  } finally {
    fs.closeSync(directoryFD);
  }
}
function countSend(kind: string) {
  const fd = fs.openSync(file("sends.jsonl"), "a", 0o600);
  try {
    fs.writeFileSync(
      fd,
      JSON.stringify({ kind, mode, pid: process.pid }) + "\n",
    );
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
let armed = false;
let app: App;
function snapshot() {
  const cs = app.store.get<Consciousness>(
    "Consciousness",
    app.host.session.consciousness_id,
  );
  return {
    pid: process.pid,
    sequence: app.store.sequence,
    epoch: app.store.epoch,
    recoveries: app.store.all<ExtractionRecovery>("ExtractionRecovery"),
    receipts: app.store
      .all<ExtractionRecovery>("ExtractionRecovery")
      .map((r) => ({
        request_id: r.request_id,
        recovery_id: app.store.receipt<string>(r.request_id, r.request_hash),
      })),
    calls: app.store.all<ModelCall>("ModelCall").map((c) => ({
      id: c.id,
      state: c.state,
      response: c.response,
      scope: c.scope,
    })),
    consciousness: cs,
    jobs: app.store.all<CompactionJob>("CompactionJob"),
    successEvents: app.store.logs.filter(
      (e) => e.event_type === "memory.extraction.succeeded",
    ).length,
    ownerEvents: app.store.logs.filter(
      (e) => e.event_type === "consciousness.committed",
    ).length,
    groups: app.host.memoryRecoveryPreflight(),
  };
}
function stopAt(name: string) {
  if (!armed || name !== boundary) return;
  durableJSON("boundary.json", { boundary: name, ...snapshot() });
  // This synchronous barrier cannot unwind, return a fake failure, or run finally.
  // Only the parent SIGKILL releases it by terminating this actual process.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  throw Error("unreachable crash barrier");
}
const quote = "I will report the synthetic result tomorrow.";
const stream: StreamFn = (model, context) => {
  const system = contentText(context.messages[0].content);
  const kind = system.includes("COMMITMENT_EXTRACTION:")
    ? "extraction"
    : system.includes("CONSCIOUSNESS:")
      ? "summary"
      : "main";
  countSend(kind);
  if (kind === "extraction") stopAt("stream-called");
  const text =
    kind === "extraction"
      ? mode === "crash" && !armed
        ? "invalid json"
        : JSON.stringify({ quotes: [quote] })
      : kind === "summary"
        ? JSON.stringify({
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
          })
        : quote;
  return replyStream([{ type: "text", text }], model);
};

try {
  app = await App.open(file("store"), { model: fixtureModel, stream });
  if (mode === "crash") {
    app.host.accept("Please report tomorrow.");
    await app.host.drain();
    await app.host.compact();
    const group = app.host.memoryRecoveryPreflight()[0];
    assert.equal(group.status, "READY");
    const request = { request_id: id(), ...group.binding! };
    durableJSON("fixture.json", { request, before: snapshot() });
    const commit = app.store.commit.bind(app.store);
    app.store.commit = (records, events = [], receipt) => {
      commit(records, events, receipt);
      if (
        events.some(
          (e) => e.event_type === "memory.extraction.recovery_authorized",
        )
      )
        stopAt("authorization");
      if (events.some((e) => e.event_type === "memory.extraction.call_linked"))
        stopAt("linked-prepared");
      if (
        records.some(
          (r) => r.record_type === "ModelCall" && r.state === "PREPARED",
        )
      )
        stopAt("prepared-unlinked");
      if (
        records.some(
          (r) => r.record_type === "ModelCall" && r.state === "IN_FLIGHT",
        )
      )
        stopAt("in-flight");
      if (
        records.some(
          (r) => r.record_type === "ModelCall" && r.state === "RESPONSE_SAVED",
        )
      )
        stopAt("response-saved");
      if (events.some((e) => e.event_type === "memory.extraction.succeeded"))
        stopAt("extraction-succeeded");
      if (events.some((e) => e.event_type === "consciousness.committed"))
        stopAt("owner-committed");
    };
    armed = true;
    await app.host.recoverMemory(request);
    throw Error("requested boundary was not reached: " + boundary);
  } else {
    assert.ok(["same", "fresh", "stale"].includes(mode));
    const fixture = JSON.parse(
      fs.readFileSync(file("fixture.json"), "utf8"),
    ) as { request: RecoveryRequest };
    const before = snapshot();
    const request =
      mode === "same"
        ? fixture.request
        : mode === "stale"
          ? { ...fixture.request, request_id: id() }
          : {
              ...(app.host.memoryRecoveryPreflight()[0]?.binding ??
                fixture.request),
              request_id: id(),
            };
    let result: unknown;
    let error: string | null = null;
    try {
      result = await app.host.recoverMemory(request);
    } catch (e) {
      error = String(e);
    }
    durableJSON(mode + ".json", {
      request,
      before,
      result,
      error,
      after: snapshot(),
    });
  }
} finally {
  if (app!) await app.close();
}
