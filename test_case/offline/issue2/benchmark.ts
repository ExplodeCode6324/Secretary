/** Offline, fixed synthetic replay. Run: npx tsx test_case/offline/issue2/benchmark.ts
 * Creates only ignored scratch stores; never touches the configured live instance.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import {
  contentText,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const script = fileURLToPath(import.meta.url);
const baseline = "29234d055932f7246800ffb40bd1edec95239550";
const digest = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function files(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? files(path.join(dir, entry.name))
        : [path.join(dir, entry.name)],
    );
}
function manifest(base: string) {
  const names = [
    ...files(path.join(base, "src/pi_secretary/src")),
    ...files(path.join(base, "src/contracts")),
    ...files(path.join(base, "src/state_machine")),
    path.join(base, "package.json"),
  ].sort();
  return Object.fromEntries(
    names.map((name) => [
      path.relative(base, name),
      digest(fs.readFileSync(name)),
    ]),
  );
}
function stats(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    ordered[Math.max(0, Math.ceil(ordered.length * p) - 1)] ?? 0;
  return {
    samples: values.length,
    p50_ms: at(0.5),
    p95_ms: at(0.95),
    min_ms: ordered[0] ?? 0,
    max_ms: ordered.at(-1) ?? 0,
    total_ms: values.reduce((a, b) => a + b, 0),
  };
}
const answer = {
  items: [
    {
      tier: "ACTIVE",
      summary:
        "Synthetic amber review remains pending under the original condition.",
      goals: [],
      constraints: ["Keep the original amber condition."],
      decisions: [],
      open_questions: [],
      unfulfilled_commitments: [],
      task_refs: [],
      pending_owner: "MAIN",
    },
  ],
  resolutions: [],
};
async function worker(base: string, variant: string, output: string) {
  for (const key of Object.keys(process.env))
    if (key.startsWith("SECRETARY_")) delete process.env[key];
  const before = manifest(base);
  const { App } = await import(
    pathToFileURL(path.join(base, "src/pi_secretary/src/app.ts")).href
  );
  const { fixtureModel, replyStream } = await import(
    pathToFileURL(path.join(base, "src/pi_secretary/src/model.ts")).href
  );
  const model = {
    ...fixtureModel,
    contextWindow: 1_000_000,
    maxTokens: 65_536,
  };
  const scenarios = [];
  for (const scenario of [
    "ordinary-eight-turns",
    "single-36k-low-occupancy",
    "forced-summary-retry",
  ]) {
    const repeats = [];
    for (let repetition = 0; repetition < 3; repetition++) {
      const directory = fs.mkdtempSync(
        path.join(path.dirname(output), ".performance-store-"),
      );
      const calls: Record<string, number> = {
        main: 0,
        summary: 0,
        extraction: 0,
      };
      const caps: Record<string, (number | null)[]> = {
        main: [],
        summary: [],
        extraction: [],
      };
      const requestBytes: Record<string, number> = {
        main: 0,
        summary: 0,
        extraction: 0,
      };
      let failed = false;
      const stream = async (m: any, context: any, options: any) => {
        const system = context.messages
          .filter((message: any) => message.role === "system")
          .map((message: any) => contentText(message.content))
          .join("\n");
        const kind = system.includes("COMMITMENT_EXTRACTION:")
          ? "extraction"
          : system.includes("CONSCIOUSNESS:")
            ? "summary"
            : "main";
        calls[kind]++;
        caps[kind].push(options?.maxTokens ?? null);
        requestBytes[kind] += Buffer.byteLength(JSON.stringify(context));
        const response = replyStream(
          [
            {
              type: "text",
              text:
                kind === "summary"
                  ? JSON.stringify(answer)
                  : kind === "extraction"
                    ? '{"quotes":[]}'
                    : "Synthetic acknowledgement; original amber condition preserved.",
            },
          ],
          m,
        );
        if (
          kind === "summary" &&
          scenario === "forced-summary-retry" &&
          !failed
        ) {
          failed = true;
          const completed = {
            ...(await response.result()),
            stopReason: "length" as const,
          };
          const result = createAssistantMessageEventStream();
          queueMicrotask(() => {
            result.push({ type: "done", reason: "length", message: completed });
            result.end(completed);
          });
          return result;
        }
        return response;
      };
      const app = await App.open(directory, { model, stream });
      const elapsed: number[] = [];
      const started = performance.now();
      try {
        for (
          let index = 0;
          index < (scenario === "ordinary-eight-turns" ? 8 : 1);
          index++
        ) {
          const text =
            scenario === "single-36k-low-occupancy"
              ? "SYNTHETIC_36K:" + "x".repeat(36 * 1024 - 14)
              : `Synthetic input ${index + 1}: keep the original amber condition.`;
          const t = performance.now();
          app.host.accept(text);
          await app.host.drain();
          app.host.maintainIfNeeded();
          await app.host.settingsIdle();
          if (scenario === "forced-summary-retry") await app.host.compact();
          elapsed.push(performance.now() - t);
        }
        const jobs = app.store.all("CompactionJob");
        repeats.push({
          repetition,
          calls,
          output_request_caps: caps,
          full_semantic_request_bytes: requestBytes,
          fixture_usage_tokens: 0,
          turn_latency: stats(elapsed),
          turn_ms: elapsed,
          total_ms: performance.now() - started,
          state: app.host.session.state,
          memory_jobs: jobs.map((job: any) => ({
            mode: job.mode ?? "LEGACY_COMPACTION",
            state: job.state,
            attempt: job.attempt ?? 1,
          })),
          committed_memory_updates: jobs.filter(
            (job: any) =>
              job.state === "COMMITTED" && job.mode !== "CONTEXT_COMPACTION",
          ).length,
          committed_context_compactions: jobs.filter(
            (job: any) =>
              job.state === "COMMITTED" &&
              (job.mode === "CONTEXT_COMPACTION" || !job.mode),
          ).length,
        });
      } finally {
        await app.close();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
    scenarios.push({
      scenario,
      repetitions: repeats,
      combined_turn_latency: stats(
        repeats.flatMap((entry: any) => entry.turn_ms),
      ),
    });
  }
  const scalability: any[] = [];
  if (variant === "current") {
    const { requestBudget } = await import(
      pathToFileURL(path.join(base, "src/pi_secretary/src/budget.ts")).href
    );
    const { contextStatus } = await import(
      pathToFileURL(path.join(base, "src/pi_secretary/src/context.ts")).href
    );
    const directory = fs.mkdtempSync(
      path.join(path.dirname(output), ".performance-poll-"),
    );
    const app = await App.open(directory, {
      model,
      stream: (m: any) =>
        replyStream([{ type: "text", text: "Synthetic poll fixture." }], m),
    });
    try {
      app.host.accept("Synthetic poll baseline.");
      await app.host.drain();
      const rawRead = app.store.read.bind(app.store);
      let reads = 0;
      app.store.read = (...args: any[]) => {
        reads++;
        return rawRead(...args);
      };
      const originalLength = app.store.logs.length;
      const template = app.store.logs[0];
      for (const count of [1000, 10000, 100000]) {
        const messages = Array.from({ length: count }, (_, index) => ({
          role: "user",
          content: `synthetic item ${index}: ` + "a".repeat(128),
          timestamp: 0,
        }));
        requestBudget(model, messages, { tools: [] });
        const scans = [];
        const heapBefore = process.memoryUsage().heapUsed;
        for (let sample = 0; sample < 12; sample++) {
          const t = performance.now();
          requestBudget(model, messages, { tools: [] });
          scans.push(performance.now() - t);
        }
        const heapAfter = process.memoryUsage().heapUsed;
        app.store.logs.length = originalLength;
        for (let index = 0; index < count; index++)
          app.store.logs.push({
            ...template,
            event_id: `synthetic-history-${index}`,
            event_type: "benchmark.unrelated",
            sequence: index + 1000000,
          });
        const cold = performance.now();
        contextStatus(app.store, app.host.session, model);
        const coldMS = performance.now() - cold;
        reads = 0;
        const polls = [];
        for (let sample = 0; sample < 200; sample++) {
          const t = performance.now();
          contextStatus(app.store, app.host.session, model);
          polls.push(performance.now() - t);
        }
        scalability.push({
          history_events: count,
          full_request_messages: count,
          full_request_bytes: Buffer.byteLength(JSON.stringify(messages)),
          full_request_scan: stats(scans),
          sampled_heap_delta_bytes: heapAfter - heapBefore,
          cold_context_status_ms: coldMS,
          warm_context_status: stats(polls),
          warm_old_body_reads: reads,
          poll_p95_under_100ms: stats(polls).p95_ms < 100,
        });
      }
      app.store.logs.length = originalLength;
    } finally {
      await app.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
  const after = manifest(base);
  fs.writeFileSync(
    output,
    JSON.stringify(
      {
        variant,
        baseline_commit: baseline,
        started_at: new Date().toISOString(),
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        benchmark_sha256: digest(fs.readFileSync(script)),
        source_manifest_before: before,
        source_manifest_after: after,
        source_changed_during_run:
          JSON.stringify(before) !== JSON.stringify(after),
        scenarios,
        scalability,
        limitations: [
          "Offline deterministic provider; fixture usage is zero and request bytes are not provider tokens or cost. A null requested cap means the wrapper did not supply maxTokens, not zero output allowance.",
          "Three independent fresh stores per replay scenario; small descriptive latency samples do not establish statistical significance.",
          "Full request scanning intentionally measures over-capacity 100k-message inputs without provider sends.",
          "Polling history is in-memory unrelated synthetic event metadata, not 100k durable database contexts; no database performance claim.",
          "Heap deltas are sampled and GC-sensitive; they are not peak RSS or event-loop delay measurements.",
          "Warm contextStatus only is measured; full HTTP/UI rendering, provider latency and live quality remain separate.",
        ],
      },
      null,
      2,
    ) + "\n",
  );
}
if (process.argv[2] === "--worker")
  await worker(process.argv[3], process.argv[4], process.argv[5]);
else {
  const reportDir = path.join(
    root,
    "test_case/reports/issue2-implementation-20261006",
  );
  fs.mkdirSync(reportDir, { recursive: true });
  const runID = new Date().toISOString().replace(/[:.]/g, "-");
  const scratch = fs.mkdtempSync(
    path.join(root, ".demo-data/issue2-benchmark-"),
  );
  try {
    const archive = path.join(scratch, "baseline.tar");
    execFileSync(
      "/usr/bin/git",
      [
        "archive",
        "--format=tar",
        `--output=${archive}`,
        baseline,
        "src/pi_secretary/src",
        "src/contracts",
        "src/state_machine",
        "package.json",
      ],
      { cwd: root },
    );
    execFileSync("/usr/bin/tar", ["-xf", archive, "-C", scratch]);
    fs.symlinkSync(
      path.join(root, "node_modules"),
      path.join(scratch, "node_modules"),
    );
    fs.symlinkSync(
      path.join(root, "src/pi_resource"),
      path.join(scratch, "src/pi_resource"),
    );
    const paths: Record<string, string> = {};
    for (const [variant, base] of [
      ["baseline", scratch],
      ["current", root],
    ]) {
      const output = path.join(
        reportDir,
        `performance-${runID}-${variant}.json`,
      );
      paths[variant] = output;
      execFileSync(
        process.execPath,
        ["--import", "tsx", script, "--worker", base, variant, output],
        { cwd: root, stdio: "inherit", timeout: 180000 },
      );
    }
    const reports = Object.fromEntries(
      Object.entries(paths).map(([variant, p]) => [
        variant,
        JSON.parse(fs.readFileSync(p, "utf8")),
      ]),
    );
    const comparison = {
      run_id: runID,
      artifacts: paths,
      baseline_archive_sha256: digest(fs.readFileSync(archive)),
      source_changed_during_run: reports.current.source_changed_during_run,
      scenarios: reports.current.scenarios.map(
        (current: any, index: number) => ({
          scenario: current.scenario,
          baseline: reports.baseline.scenarios[index].repetitions.map(
            (v: any) => ({
              calls: v.calls,
              output_request_caps: v.output_request_caps,
              committed_memory_updates: v.committed_memory_updates,
              committed_context_compactions: v.committed_context_compactions,
            }),
          ),
          current: current.repetitions.map((v: any) => ({
            calls: v.calls,
            output_request_caps: v.output_request_caps,
            committed_memory_updates: v.committed_memory_updates,
            committed_context_compactions: v.committed_context_compactions,
          })),
          baseline_latency:
            reports.baseline.scenarios[index].combined_turn_latency,
          current_latency: current.combined_turn_latency,
        }),
      ),
      scalability: reports.current.scalability,
      limitations: reports.current.limitations,
    };
    const output = path.join(reportDir, `performance-${runID}-comparison.json`);
    fs.writeFileSync(output, JSON.stringify(comparison, null, 2) + "\n");
    process.stdout.write(output + "\n");
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
