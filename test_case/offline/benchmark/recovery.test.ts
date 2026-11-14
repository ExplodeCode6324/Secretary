import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Domains } from "../../online/benchmark/domain.ts";
import {
  repository,
  read,
  readJSON,
  writeJSON,
} from "../../online/benchmark/io.ts";
import { stopDatabase } from "../../online/benchmark/postgres.ts";
import { validateRestoredRecords } from "../../online/benchmark/snapshot.ts";

async function ownedTest(root: string, fn: (d: Domains) => Promise<void>) {
  return Domains.use(root, async (d) => {
    try {
      await fn(d);
    } finally {
      for (const name of fs.readdirSync(path.join(root, "runs"))) {
        const id = name.replace(/\.json$/, "");
        const raw = d.raw(id);
        if (
          [
            "RETIRED",
            "CLEANED",
            "CREATING",
            "INCOMPLETE",
            "RESTORING",
          ].includes(raw.state)
        )
          continue;
        await d.stop(id);
        await stopDatabase(raw.database);
      }
    }
  });
}

test("restore preflight rejects uncertain effects and every external capability before Core opens", () => {
  const work = "/owned/slot/core/workspaces";
  const refuses = (record: any, code: RegExp, sink: any[] = []) =>
    assert.throws(() => validateRestoredRecords([record], work, sink), code);
  refuses({ record_type: "Scope", kind: "DIRECTORY" }, /EXTERNAL_SCOPE/);
  refuses({ record_type: "ProgramRegistration" }, /PROGRAM/);
  refuses({ record_type: "AuthorizationRule" }, /AUTHORIZATION/);
  refuses(
    {
      record_type: "Operation",
      action: { action: "scope.import", resource: "scope/import/id" },
    },
    /UNSUPPORTED_OPERATION_CAPABILITY/,
  );
  refuses(
    {
      record_type: "Operation",
      action: { action: "shell.run", resource: work },
      rule_id: null,
    },
    /UNSUPPORTED_OPERATION_CAPABILITY/,
  );
  refuses(
    {
      record_type: "Execution",
      workspace_binding: { kind: "NONE", root_path: work + "-other/task" },
    },
    /OUTSIDE_SLOT/,
  );
  refuses(
    {
      record_type: "Operation",
      action: { action: "file.write", resource: "/outside" },
    },
    /OUTSIDE_SLOT/,
  );
  refuses(
    { record_type: "Operation", action: { action: "program.run" } },
    /PROGRAM/,
  );
  refuses(
    {
      record_type: "Operation",
      process: { state: "RUNNING", pid: process.pid, token: "foreign" },
      action: { action: "file.write", resource: work + "/task/work/a" },
    },
    /UNCONFIRMED/,
  );
  refuses(
    { record_type: "PushTarget", kind: "HTTP", endpoint: "http://127.0.0.1" },
    /UNSAFE_PUSH/,
  );
  refuses(
    { record_type: "PushDispatch", id: "p", state: "SENDING" },
    /AMBIGUOUS_PUSH/,
  );
  refuses(
    {
      record_type: "PushDispatch",
      id: "p",
      state: "DISPATCHED",
      batch_id: "b",
      attempt_history: [{ id: "a" }],
    },
    /DISAGREEMENT/,
  );
  const call = { dispatches: [{ id: "p", batch: "b", attempt: "a" }] };
  refuses(
    {
      record_type: "PushDispatch",
      id: "p",
      state: "PENDING",
      batch_id: "b",
      attempt_history: [{ id: "a" }],
    },
    /DISAGREEMENT/,
    [call],
  );
  refuses(
    {
      record_type: "PushDispatch",
      id: "p",
      state: "DISPATCHED",
      batch_id: "b",
      attempt_history: [{ id: "a" }],
    },
    /DISAGREEMENT/,
    [call, call],
  );
  assert.throws(
    () => validateRestoredRecords([], work, [call]),
    /DISAGREEMENT/,
  );
  validateRestoredRecords(
    [
      {
        record_type: "PushDispatch",
        id: "p",
        state: "DISPATCHED",
        batch_id: "b",
        attempt_history: [{ id: "a" }],
      } as any,
    ],
    work,
    [call],
  );
});
for (const phase of ["before-retire", "after-retire", "after-promote"] as const)
  test(
    `interrupted restore ${phase} resumes only the verified incarnation`,
    { timeout: 90000 },
    async (t) => {
      const root = path.join(
        repository,
        ".local/benchmark/tests",
        randomUUID(),
      );
      await ownedTest(root, async (d) => {
        const source = await d.start((await d.create()).id);
        const checkpoint = await d.checkpoint(source.id);
        const cpDir = path.join(root, "checkpoints", checkpoint);
        const dump = read(path.join(cpDir, "postgres.dump"));
        fs.appendFileSync(path.join(cpDir, "postgres.dump"), "corrupt");
        await assert.rejects(
          () => d.restore(source.id, checkpoint),
          /CHECKPOINT_CORRUPT/,
        );
        fs.writeFileSync(path.join(cpDir, "postgres.dump"), dump, {
          mode: 0o600,
        });
        const rename = fs.renameSync.bind(fs);
        let injected = false;
        t.mock.method(fs, "renameSync", (a: any, b: any) => {
          const retire = String(b) === path.join(root, "retired", source.id),
            promote =
              String(a).includes("/staging-") && String(b) === source.active;
          if (
            !injected &&
            ((phase === "before-retire" && retire) ||
              (phase === "after-retire" && retire) ||
              (phase === "after-promote" && promote))
          ) {
            injected = true;
            if (phase !== "before-retire") rename(a, b);
            throw Error("INJECTED_CONTROLLER_EXIT");
          }
          return rename(a, b);
        });
        try {
          await assert.rejects(
            () => d.restore(source.id, checkpoint),
            /INJECTED_CONTROLLER_EXIT/,
          );
        } finally {
          t.mock.restoreAll();
        }
        assert(injected);
        const pending = fs
          .readdirSync(path.join(root, "runs"))
          .map((f) => readJSON(path.join(root, "runs", f)))
          .find((r) => r.state === "RESTORING");
        assert(pending);
        if (phase === "before-retire") {
          await assert.rejects(
            () => d.start(source.id),
            /LINEAGE_RESTORE_INCOMPLETE/,
          );
          await assert.rejects(
            () => d.restore(source.id, checkpoint),
            /LINEAGE_RESTORE_INCOMPLETE/,
          );
          await assert.rejects(
            () => d.clean(source.id),
            /LINEAGE_RESTORE_INCOMPLETE/,
          );
        }
        const imported = path.join(pending.evidence, "restore-import.json"),
          original = readJSON(imported);
        writeJSON(imported, { ...original, dump: "forged" });
        await assert.rejects(() => d.recover(pending.id), /IMPORT_INCOMPLETE/);
        writeJSON(imported, original);
        const recovered = await d.recover(pending.id);
        assert.equal(recovered.state, "STOPPED");
        assert.equal(d.load(source.id).state, "RETIRED");
        await assert.rejects(
          () => d.clean(source.id),
          /CLEAN_REQUIRES_STOPPED/,
        );
        await d.start(recovered.id);
        await d.seal(recovered.id);
        // Crash after the move but before the registry tombstone is committed.
        const save = d.save.bind(d);
        t.mock.method(d, "save", (r: any) => {
          if (r.state === "CLEANED") throw Error("INJECTED_CLEAN_EXIT");
          return save(r);
        });
        try {
          await assert.rejects(
            () => d.clean(recovered.id),
            /INJECTED_CLEAN_EXIT/,
          );
        } finally {
          t.mock.restoreAll();
        }
        assert.equal((await d.recover(recovered.id)).state, "CLEANED");
        assert.equal((await d.recover(recovered.id)).state, "CLEANED");
        await stopDatabase(recovered.database);
      });
    },
  );

test(
  "killed worker preserves uncertain actual write; restored original resource reconciles without redo",
  { timeout: 90000 },
  async () => {
    const { CoreClient } =
      await import("../../../src/pi_secretary/src/core-client.ts");
    const { until, processStatus } =
      await import("../../online/benchmark/io.ts");
    const root = path.join(repository, ".local/benchmark/tests", randomUUID());
    await ownedTest(root, async (d) => {
      const r = await d.start((await d.create()).id);
      const client = new CoreClient(r.endpoint!);
      await client.command("task-requests", {
        request_id: randomUUID(),
        goal: "BENCHMARK_INTERRUPTED_WRITE",
        acceptance: ["Fixture crash after fsync"],
      });
      const barrier = path.join(r.evidence, "write-barrier.jsonl");
      await until(() => fs.existsSync(barrier));
      await until(() => processStatus(r.process) === "STOPPED");
      const receipt = JSON.parse(read(barrier).toString());
      assert.equal(read(receipt.resource).toString(), "uncertain");
      await d.stop(r.id);
      const cp = await d.checkpoint(r.id),
        restored = await d.restore(r.id, cp);
      const live = await d.start(restored.id);
      const observation = () =>
        readJSON(path.join(live.evidence, "observed.json"));
      await until(() =>
        observation().operations.some(
          (o: any) =>
            o.id === receipt.operation_id && o.state === "RESULT_UNKNOWN",
        ),
      );
      assert.equal(
        fs.existsSync(path.join(live.evidence, "write-barrier.jsonl")),
        false,
      );
      const rc = new CoreClient(live.endpoint!);
      const verified: any = await rc.command(
        "operations/" + receipt.operation_id + "/verify-write",
        { request_id: randomUUID() },
      );
      await until(() =>
        observation().operations.some(
          (o: any) => o.id === receipt.operation_id && o.state === "SUCCEEDED",
        ),
      );
      assert.equal(read(receipt.resource).toString(), "uncertain");
      await d.seal(live.id);
      await d.clean(live.id);
    });
  },
);
test(
  "counted local push survives restore; missed AT pauses while post-ready AT executes",
  { timeout: 90000 },
  async () => {
    const { CoreClient } =
      await import("../../../src/pi_secretary/src/core-client.ts");
    const { until } = await import("../../online/benchmark/io.ts");
    const root = path.join(repository, ".local/benchmark/tests", randomUUID());
    await ownedTest(root, async (d) => {
      const r = await d.start((await d.create()).id),
        client = new CoreClient(r.endpoint!);
      const observe = (run: any) =>
        readJSON(path.join(run.evidence, "observed.json"));
      await client.command("push-targets", {
        request_id: randomUUID(),
        name: "Private counted sink",
        kind: "MACOS_NOTIFICATION",
        endpoint: null,
        enabled: true,
        quiet_hours: null,
      });
      await client.command("task-requests", {
        request_id: randomUUID(),
        goal: "BENCHMARK_WRITE_ALPHA",
        acceptance: ["Actual local write"],
      });
      await client.command("messages", {
        request_id: randomUUID(),
        text: "BENCHMARK_NOTIFY",
      });
      await until(() =>
        observe(r).pushes.some((p: any) => p.state === "DISPATCHED"),
      );
      const previous = d
        .sink(r)
        .flatMap((c) => c.dispatches.map((x: any) => x.id));
      assert(previous.length > 0);
      const due = Date.now() + 4000;
      await client.command("task-requests", {
        request_id: randomUUID(),
        goal: "BENCHMARK_MISSED_AT",
        at: new Date(due).toISOString(),
        acceptance: ["Must pause when missed"],
      });
      await d.stop(r.id);
      assert(Date.now() < due, "Timing setup missed the intended stop barrier");
      const cp = await d.checkpoint(r.id),
        restored = await d.restore(r.id, cp);
      await until(() => Date.now() > due);
      const live = await d.start(restored.id),
        rc = new CoreClient(live.endpoint!);
      await until(() =>
        observe(live).tasks.some(
          (p: any) =>
            p.trigger.at === new Date(due).toISOString() &&
            p.state === "PAUSED",
        ),
      );
      const missed = observe(live).tasks.find(
        (p: any) => p.trigger.at === new Date(due).toISOString(),
      );
      assert(
        !observe(live).executions.some((e: any) => e.task_id === missed.id),
      );
      const futureAt = new Date(Date.now() + 2000).toISOString();
      await rc.command("task-requests", {
        request_id: randomUUID(),
        goal: "BENCHMARK_FUTURE_AT",
        at: futureAt,
        acceptance: ["Execute after readiness"],
      });
      await until(() => {
        const p = observe(live).tasks.find(
          (p: any) => p.trigger.at === futureAt,
        );
        return (
          p &&
          observe(live).executions.some(
            (e: any) => e.task_id === p.id && e.state === "SUCCEEDED",
          )
        );
      });
      for (const id of previous)
        assert.equal(
          d
            .sink(live)
            .flatMap((c) => c.dispatches)
            .filter((x: any) => x.id === id).length,
          1,
        );
      await d.seal(live.id);
      await d.clean(live.id);
    });
  },
);

test(
  "stale derived PG index rebuilds from the same authoritative journal",
  { timeout: 90000 },
  async () => {
    const { CoreClient } =
      await import("../../../src/pi_secretary/src/core-client.ts");
    const { until } = await import("../../online/benchmark/io.ts");
    const { query, indexEvidence } =
      await import("../../online/benchmark/postgres.ts");
    const root = path.join(repository, ".local/benchmark/tests", randomUUID());
    await ownedTest(root, async (d) => {
      const run = await d.start((await d.create()).id);
      await new CoreClient(run.endpoint!).command("messages", {
        request_id: randomUUID(),
        text: "Synthetic stale-index evidence",
      });
      await d.stop(run.id);
      const original = await indexEvidence(run.database);
      assert(original.documents.length > 0);
      await query(run.database, "TRUNCATE mem.chunk,mem.document");
      const live = await d.start(run.id);
      await until(async () => {
        const next = await indexEvidence(live.database);
        return original.documents.every((row) =>
          next.documents.some(
            (n) => n.event_id === row.event_id && n.xmin !== row.xmin,
          ),
        );
      });
      await d.seal(live.id);
      await d.clean(live.id);
    });
  },
);

test(
  "a checkpoint cannot roll back acknowledged sink effects produced after capture",
  { timeout: 90000 },
  async () => {
    const { CoreClient } =
      await import("../../../src/pi_secretary/src/core-client.ts");
    const { until } = await import("../../online/benchmark/io.ts");
    const root = path.join(repository, ".local/benchmark/tests", randomUUID());
    await ownedTest(root, async (d) => {
      const r = await d.start((await d.create()).id),
        client = new CoreClient(r.endpoint!);
      await client.command("push-targets", {
        request_id: randomUUID(),
        name: "Private checkpoint sink",
        kind: "MACOS_NOTIFICATION",
        endpoint: null,
        enabled: true,
        quiet_hours: null,
      });
      await client.command("messages", {
        request_id: randomUUID(),
        text: "BENCHMARK_NOTIFY before",
      });
      await until(() =>
        readJSON(path.join(r.evidence, "observed.json")).pushes.some(
          (p: any) => p.state === "DISPATCHED",
        ),
      );
      const cp = await d.checkpoint(r.id),
        before = d.sink(r).length;
      const resumed = await d.start(r.id);
      await new CoreClient(resumed.endpoint!).command("messages", {
        request_id: randomUUID(),
        text: "BENCHMARK_NOTIFY after",
      });
      await until(() => d.sink(resumed).length > before);
      await d.stop(r.id);
      await stopDatabase(r.database);
      await assert.rejects(
        () => d.restore(r.id, cp),
        /SINK_ADVANCED_AFTER_CHECKPOINT/,
      );
      assert.equal(d.load(r.id).state, "STOPPED");
      assert.equal(fs.readdirSync(path.join(root, "runs")).length, 1);
      await d.seal(r.id);
      await d.clean(r.id);
    });
  },
);
