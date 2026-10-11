import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import { id, now } from "../../../src/pi_secretary/src/store.ts";
import type { ExtractionRecovery } from "../../../src/pi_secretary/src/contracts.ts";
for (const phase of ["main", "tool", "summary", "extraction", "failure"])
  test(`real SIGKILL at ${phase} durable boundary preserves model work and attempt count`, async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "secretary-issue19-kill-"),
    );
    async function worker(mode: string) {
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "test_case/offline/issue19/helpers/crash.ts",
          dir,
          phase,
          mode,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.on("data", (d) => (output += d));
      child.stderr.on("data", (d) => (output += d));
      const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
      try {
        const [code, signal] = await once(child, "exit");
        return { code, signal, output };
      } finally {
        clearTimeout(timer);
      }
    }
    try {
      const first = await worker("crash");
      assert.equal(first.signal, "SIGKILL", first.output);
      const before = fs
        .readFileSync(path.join(dir, "sends.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((s) => JSON.parse(s));
      const result = await worker("resume");
      assert.equal(result.code, 0, result.output);
      const after = fs
        .readFileSync(path.join(dir, "sends.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((s) => JSON.parse(s));
      const state = JSON.parse(
        fs.readFileSync(path.join(dir, "result.json"), "utf8"),
      );
      assert.equal(state.state, "IDLE");
      if (phase === "failure") {
        assert.equal(after.length, 2);
        assert.deepEqual(
          state.calls.map(
            (c: { transport_attempt: number }) => c.transport_attempt,
          ),
          [1, 2],
        );
      } else if (phase === "tool") {
        assert.equal(after.filter((c) => c.kind === "main").length, 2);
        assert.equal(state.notifications.length, 1);
      } else {
        const kind = phase === "main" ? "main" : phase;
        assert.equal(
          after.filter((c) => c.kind === kind).length,
          before.filter((c) => c.kind === kind).length,
          "saved success must not be sent again",
        );
      }
      if (phase === "summary" || phase === "extraction") {
        assert.equal(state.summary.state, "COMMITTED");
        assert(state.jobs.every((j: { merged: boolean }) => j.merged));
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
test("historical CLAIMED and terminal ExtractionRecovery records remain readable without changing journal prefix", async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "secretary-issue19-legacy-"),
  );
  let app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
  try {
    const schema = JSON.parse(
      fs.readFileSync("src/contracts/contracts.schema.json", "utf8"),
    );
    // Construct synthetic historical shapes from required fields; no production recovery writer remains.
    function value(s: any): any {
      if (s.$ref) {
        const name = s.$ref.split("/").at(-1);
        if (name === "ObjectRef") return app.store.put([]);
        return value(schema.$defs[name]);
      }
      if ("const" in s) return s.const;
      if (s.enum) return s.enum[0];
      if (s.anyOf) return value(s.anyOf[0]);
      if (s.type === "object")
        return Object.fromEntries(
          (s.required ?? []).map((k: string) => [
            k,
            k === "session_id" ? app.host.sessionID : value(s.properties[k]),
          ]),
        );
      if (s.type === "array") return [];
      if (s.type === "integer" || s.type === "number") return s.minimum ?? 1;
      if (s.format === "uuid") return id();
      if (s.format === "date-time") return now();
      if (s.pattern?.includes("64")) return "0".repeat(64);
      if (s.type === "boolean") return false;
      if (s.type === "null") return null;
      return "synthetic";
    }
    const records = ["CLAIMED", "SUCCEEDED", "FAILED", "BLOCKED"].map(
      (state) => ({ ...value(schema.$defs.ExtractionRecovery), state }),
    ) as ExtractionRecovery[];
    app.store.commit(records);
    const prefix = fs.readFileSync(path.join(dir, "journal.jsonl"));
    await app.close();
    app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
    assert.equal(app.store.all("ExtractionRecovery").length, 4);
    assert.deepEqual(
      fs
        .readFileSync(path.join(dir, "journal.jsonl"))
        .subarray(0, prefix.length),
      prefix,
    );
    assert.deepEqual(
      app.store
        .all<ExtractionRecovery>("ExtractionRecovery")
        .map((r) => r.state),
      ["CLAIMED", "SUCCEEDED", "FAILED", "BLOCKED"],
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
