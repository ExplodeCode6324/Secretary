import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import { Domains, configuration, type Run } from "./domain.ts";
import {
  inventory,
  mkdir,
  read,
  readJSON,
  requireThat,
  sha,
  until,
  writeJSON,
} from "./io.ts";
import { indexEvidence, query, stopDatabase } from "./postgres.ts";
import {
  machine,
  markdown,
  validateReport,
  type Report,
} from "../../benchmarks/common/report.ts";

export async function selfCheck(root: string) {
  return Domains.use(root, async (domains) => {
    const started_at = new Date().toISOString(),
      runs: Run[] = [];
    const report: Report = {
      schema: "secretary-test-report-v1",
      run_id: randomUUID(),
      track: "correctness",
      source: {},
      configuration,
      evidence_classes: ["SCRIPTED_PROTOCOL", "REAL_PROCESS", "REAL_POSTGRES"],
      started_at,
      finished_at: started_at,
      cases: [],
      metrics: { physical_provider_sends: 0, provider_usage: null },
      first_failure: null,
      machine: machine(),
      limitations: [
        "Infrastructure protocol only. Real-model workloads, hidden semantic oracles and scoring belong to #121.",
        "Restore reuses a canonical lineage pathname with a new owned directory; arbitrary-path portability is not supported.",
        "Controlled push delivery is not a real external service test.",
      ],
    };
    let current = "fresh-domain";
    const pass = (id: string, evidence: string[]) =>
      report.cases.push({ id, status: "PASS", evidence });
    const observe = (run: Run) =>
      readJSON(path.join(run.evidence, "observed.json"));
    try {
      let a = await domains.create();
      runs.push(a);
      a = await domains.start(a.id);
      runs[0] = a;
      report.source = a.frozen;
      let client = new CoreClient(a.endpoint!);
      const request = {
        request_id: randomUUID(),
        text: "Synthetic infrastructure state; no external action.",
      };
      await client.command("messages", request);
      const taskRequest = {
        request_id: randomUUID(),
        goal: "BENCHMARK_WRITE_ALPHA",
        acceptance: ["Write the fixture file"],
      };
      const taskReceipt = await client.command("task-requests", taskRequest);
      await until(() =>
        observe(a).executions.some((e: any) => e.state === "SUCCEEDED"),
      );
      const first = observe(a).executions.find(
        (e: any) => e.state === "SUCCEEDED",
      );
      const sourceFile = path.join(
        first.workspace_binding.root_path,
        "continuity.txt",
      );
      assert.equal(read(sourceFile).toString(), "alpha");
      const b = await domains.start((await domains.create()).id);
      runs.push(b);
      assert.equal(observe(b).inputs, 0);
      assert.equal(observe(b).executions.length, 0);
      assert.notEqual(a.endpoint!.token, b.endpoint!.token);
      assert.notEqual(a.database.systemID, b.database.systemID);
      assert.notEqual(a.active, b.active);
      assert.equal(
        fs.existsSync(
          path.join(
            b.active,
            "core/workspaces",
            first.task_id,
            "work/continuity.txt",
          ),
        ),
        false,
      );
      await domains.seal(b.id);
      await domains.clean(b.id);
      pass(current, [
        "Two actual Core/PG domains; distinct tokens, PG system IDs, workspaces and empty second-domain state",
      ]);
      current = "same-run-restart";
      const oldPID = a.endpoint!.pid,
        oldInstance = a.endpoint!.instance_id,
        oldSession = observe(a).session_id;
      await domains.stop(a.id);
      a = await domains.start(a.id);
      client = new CoreClient(a.endpoint!);
      assert.notEqual(a.endpoint!.pid, oldPID);
      assert.notEqual(a.endpoint!.instance_id, oldInstance);
      assert.equal(observe(a).session_id, oldSession);
      assert.deepEqual(
        await client.command("task-requests", taskRequest),
        taskReceipt,
      );
      await assert.rejects(
        () =>
          client.command("task-requests", { ...taskRequest, goal: "changed" }),
        /REQUEST_CONFLICT/,
      );
      assert.equal(observe(a).executions.length, 1);
      pass(current, [
        "Old OS PID stopped, new PID/instance; original session and request receipt; changed-body conflict",
      ]);
      current = "restore-continue";
      const checkpoint = await domains.checkpoint(a.id),
        oldInode = fs.statSync(a.active).ino;
      const restored = await domains.restore(a.id, checkpoint);
      runs.push(restored);
      const retired = domains.load(a.id),
        retiredBefore = sha(JSON.stringify(inventory(retired.active)));
      assert.notEqual(fs.statSync(restored.active).ino, oldInode);
      assert.equal(restored.active, a.active);
      assert.notEqual(restored.database.systemID, a.database.systemID);
      const imported = await indexEvidence(restored.database);
      writeJSON(path.join(restored.evidence, "imported-index.json"), imported);
      const r = await domains.start(restored.id),
        rc = new CoreClient(r.endpoint!);
      assert.equal(r.endpoint!.data_domain_id, a.endpoint!.data_domain_id);
      assert.notEqual(r.endpoint!.token, a.endpoint!.token);
      assert.equal(observe(r).session_id, oldSession);
      await until(
        async () =>
          Number(
            (
              await query(
                r.database,
                "SELECT journal_sequence FROM mem.checkpoint",
              )
            )[0].journal_sequence,
          ) >= observe(r).sequence,
      );
      const accepted = await indexEvidence(r.database);
      writeJSON(path.join(r.evidence, "accepted-index.json"), accepted);
      for (const table of ["documents", "chunks"] as const)
        for (const row of imported[table])
          assert(
            accepted[table].some(
              (candidate) => JSON.stringify(candidate) === JSON.stringify(row),
            ),
            "Imported row xmin changed: hidden index rebuild",
          );
      assert.deepEqual(
        await rc.command("task-requests", taskRequest),
        taskReceipt,
      );
      await rc.command("task-requests", {
        request_id: randomUUID(),
        goal: "BENCHMARK_CONTINUE",
        reuse_task_id: first.task_id,
        parent_execution_id: first.id,
        acceptance: ["Read and update fixture file"],
      });
      await until(
        () =>
          observe(r).executions.filter((e: any) => e.state === "SUCCEEDED")
            .length === 2,
      );
      assert.equal(read(sourceFile).toString(), "beta");
      assert.equal(
        read(
          path.join(
            retired.active,
            "core/workspaces",
            first.task_id,
            "work/continuity.txt",
          ),
        ).toString(),
        "alpha",
      );
      assert.equal(
        sha(JSON.stringify(inventory(retired.active))),
        retiredBefore,
      );
      await assert.rejects(() => domains.clean(a.id), /CLEAN_REQUIRES_STOPPED/);
      pass(current, [
        "New owned physical directory and PG cluster; actual dump import; stable xmin; continued original Shared task; retired source untouched",
      ]);
      current = "tool-boundary";
      await rc.command("task-requests", {
        request_id: randomUUID(),
        goal: "BENCHMARK_ESCAPE",
        acceptance: ["Expected path refusal"],
      });
      await until(() =>
        observe(r).executions.some((e: any) => e.state === "FAILED"),
      );
      const calls = read(
        path.join(r.evidence, "fixture-calls.jsonl"),
      ).toString();
      assert(calls.includes("INVALID_PATH"));
      const canary = "hidden-oracle-" + randomUUID();
      const oracle = path.join(r.evidence, "controller-oracle"),
        link = path.join(first.workspace_binding.root_path, "oracle-link");
      fs.writeFileSync(oracle, canary, { mode: 0o600 });
      fs.symlinkSync(oracle, link);
      try {
        for (const suffix of ["ABSOLUTE", "SYMLINK"]) {
          const failed = observe(r).executions.filter(
            (e: any) => e.state === "FAILED",
          ).length;
          await rc.command("task-requests", {
            request_id: randomUUID(),
            goal: "BENCHMARK_ESCAPE_" + suffix,
            reuse_task_id: first.task_id,
            parent_execution_id: observe(r)
              .executions.filter((e: any) => e.task_id === first.task_id)
              .at(-1).id,
            acceptance: ["Expected read refusal"],
          });
          await until(
            () =>
              observe(r).executions.filter((e: any) => e.state === "FAILED")
                .length ===
              failed + 1,
          );
        }
        const captured = read(
          path.join(r.evidence, "fixture-calls.jsonl"),
        ).toString();
        assert(
          !captured.includes(canary),
          "Hidden oracle leaked into model context",
        );
      } finally {
        fs.unlinkSync(link);
      }
      pass(current, [
        "Actual ../, absolute-path and symlink read refusals; hidden oracle canary absent from every captured fixture model context",
      ]);
      current = "checkpoint-integrity";
      await domains.stop(r.id);
      await assert.rejects(
        () => domains.restore(r.id, checkpoint),
        /SOURCE_NOT_STOPPED|CHECKPOINT_MISMATCH|CHECKPOINT_SEAL_MISMATCH/,
      );
      pass(current, [
        "Foreign-source checkpoint cannot be attached as a fresh independent repeat",
      ]);
      await domains.seal(r.id);
      await domains.clean(r.id);
      pass("evidence-preserving-clean", [
        "Worker and PG stopped; evidence hashes sealed; active directory reversibly retired; no recursive deletion",
      ]);
    } catch (e) {
      report.first_failure = String(e);
      report.cases.push({
        id: current,
        status: "FAIL",
        reason: String(e),
        evidence: [],
      });
      writeJSON(path.join(root, "failure-" + report.run_id + ".json"), {
        case: current,
        error: String(e),
        stack: (e as Error).stack,
      });
    } finally {
      for (const run of runs) {
        try {
          const actual = domains.load(run.id);
          if (["RETIRED", "CLEANED"].includes(actual.state)) continue;
          await domains.stop(actual.id);
          await stopDatabase(actual.database);
        } catch (e) {
          report.cases.push({
            id: "shutdown-" + run.id,
            status: "INCOMPLETE",
            reason: String(e),
            evidence: [],
          });
        }
      }
    }
    const expected = [
      "fresh-domain",
      "same-run-restart",
      "restore-continue",
      "tool-boundary",
      "checkpoint-integrity",
      "evidence-preserving-clean",
    ];
    for (const id of expected)
      if (!report.cases.some((c) => c.id === id))
        report.cases.push({
          id,
          status: "NOT_TESTED",
          reason: "Earlier infrastructure failure",
          evidence: [],
        });
    report.cases.push({
      id: "memory-workload",
      status: "NOT_APPLICABLE",
      reason: "Master assigned concrete benchmark workloads to #121",
      evidence: [],
    });
    report.metrics.domains = runs.map((run) => {
      try {
        const actual = domains.load(run.id);
        const seen = readJSON(path.join(actual.evidence, "observed.json"));
        return {
          run_id: actual.id,
          lineage: actual.lineage,
          parent: actual.parent ?? null,
          checkpoint: actual.checkpoint ?? null,
          state: actual.state,
          private_evidence: actual.evidence,
          core_bytes: inventory(actual.active).reduce((n, f) => n + f.bytes, 0),
          pg_bytes: inventory(actual.database.directory).reduce(
            (n, f) => n + f.bytes,
            0,
          ),
          model_calls: seen.model_calls,
          last_observed_rss_bytes: seen.rss,
        };
      } catch {
        return { run_id: run.id, metrics: "UNAVAILABLE" };
      }
    });
    report.finished_at = new Date().toISOString();
    report.metrics.elapsed_ms =
      Date.parse(report.finished_at) - Date.parse(started_at);
    const directory = path.join(root, "reports", report.run_id);
    mkdir(directory);
    writeJSON(path.join(directory, "report.json"), validateReport(report));
    fs.writeFileSync(path.join(directory, "report.md"), markdown(report), {
      mode: 0o600,
    });
    return { report, directory };
  });
}
