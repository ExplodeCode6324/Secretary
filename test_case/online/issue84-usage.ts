import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hash } from "../../src/pi_secretary/src/store.ts";
import type { Attempt, LedgerState } from "./issue84-budget.ts";

// Official DeepSeek Flash rates checked 2026-11-05. Unknown holidays use
// the higher weekday peak estimate; these are estimates, never invoices.
export function estimatedCost(a: Attempt) {
  if (!a.usage) return null;
  const u = a.usage;
  const peak =
    (u.input * 0.3 +
      u.cacheRead * 0.006 +
      u.cacheWrite * 0.3 +
      u.output * 1.2) /
    1e6;
  const d = new Date(a.started),
    h = d.getUTCHours();
  const peakWindow =
    d.getUTCDay() >= 1 &&
    d.getUTCDay() <= 5 &&
    ((h >= 1 && h < 4) || (h >= 6 && h < 10));
  return {
    peakUSD: peak,
    timestampEstimateUSD: peakWindow ? peak : peak / 2,
    peakWindow,
  };
}

/** Reported tokens are distinct from conservative exposure and unknown billing. */
export function totals(attempts: Attempt[]) {
  const known = attempts.filter(
    (a) => a.actualInput !== undefined && a.actualOutput !== undefined,
  );
  const split = known.filter((a) => a.usage);
  const sum = (f: (a: Attempt) => number) =>
    attempts.reduce((n, a) => n + f(a), 0);
  return {
    physicalRequests: attempts.length,
    knownUsageRequests: known.length,
    unknownUsageRequests: attempts.length - known.length,
    missingCacheSplitRequests: known.length - split.length,
    reportedInput: known.reduce((n, a) => n + a.actualInput!, 0),
    reportedOutput: known.reduce((n, a) => n + a.actualOutput!, 0),
    cacheMissInput: split.reduce((n, a) => n + a.usage!.input, 0),
    cacheRead: split.reduce((n, a) => n + a.usage!.cacheRead, 0),
    cacheWrite: split.reduce((n, a) => n + a.usage!.cacheWrite, 0),
    reasoningWithinOutput: split.reduce(
      (n, a) => n + (a.usage!.reasoning ?? 0),
      0,
    ),
    chargedActiveSeconds: sum((a) => a.ms) / 1000,
    conservativeUSD: sum((a) => a.nanoUSD) / 1e9,
    timestampEstimatedUSD: split.reduce(
      (n, a) => n + estimatedCost(a)!.timestampEstimateUSD,
      0,
    ),
    cacheAwarePeakUSD: split.reduce((n, a) => n + estimatedCost(a)!.peakUSD, 0),
  };
}

function records(root: string) {
  const core = path.join(root, "core");
  const read = (ref: { path: string; sha256: string }) => {
    const file = path.resolve(core, ref.path);
    assert(file.startsWith(core + path.sep), "EVIDENCE_OUTSIDE_CORE");
    const raw = fs.readFileSync(file);
    assert.equal(hash(raw), ref.sha256, "EVIDENCE_HASH_CHANGED");
    return JSON.parse(raw.toString());
  };
  const latest = new Map<string, any>();
  for (const line of fs
    .readFileSync(path.join(core, "journal.jsonl"), "utf8")
    .trim()
    .split("\n")) {
    const envelope = JSON.parse(line),
      raw = Buffer.from(envelope.payload_b64, "base64");
    assert.equal(hash(raw), envelope.sha256, "JOURNAL_HASH_CHANGED");
    const transaction = JSON.parse(raw.toString());
    for (const mutation of transaction.mutations) {
      if (
        ["ModelCall", "Context", "CompactionJob"].includes(mutation.object_type)
      )
        latest.set(mutation.object_id, read(mutation.snapshot));
    }
  }
  return { latest, read };
}

export function usageReport(root: string) {
  root = path.resolve(root);
  const ledger = JSON.parse(
    fs.readFileSync(path.join(root, "usage.json"), "utf8"),
  ) as LedgerState;
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
  );
  const attempts = structuredClone(ledger.attempts);
  const domains = [...new Set(attempts.map((a) => a.domain ?? root))];
  const links: any[] = [],
    mismatches: string[] = [];
  const staleAttempts: Attempt[] = [];
  const staleJobs = new Set<string>();
  for (const domain of domains) {
    const { latest, read } = records(domain);
    const calls = [...latest.values()].filter(
      (r) => r.record_type === "ModelCall",
    );
    for (const job of latest.values())
      if (
        job.record_type === "CompactionJob" &&
        job.mode === "WORKING_MEMORY" &&
        job.state === "STALE"
      )
        staleJobs.add(domain + ":" + job.id);
    const used = new Set<string>();
    for (const a of attempts.filter((a) => (a.domain ?? root) === domain)) {
      const matches = calls.filter((c) => {
        if (used.has(c.id)) return false;
        if (a.responseId && c.response)
          return read(c.response).responseId === a.responseId;
        const context = latest.get(c.context_id);
        const identity =
          c.scope.execution_id ?? c.scope.session_id ?? context?.loop_id;
        return (
          (!a.sessionId || identity === a.sessionId) &&
          Date.parse(c.started_at) <= a.started &&
          (!c.completed_at || Date.parse(c.completed_at) >= a.started)
        );
      });
      if (matches.length !== 1) {
        mismatches.push(
          `attempt ${domain}:${a.started} matches ${matches.length} calls`,
        );
        continue;
      }
      const c = matches[0];
      used.add(c.id);
      const context = latest.get(c.context_id);
      const summaryJob = latest.get(context?.loop_id);
      if (
        summaryJob?.record_type === "CompactionJob" &&
        summaryJob.state === "STALE"
      )
        staleAttempts.push(a);
      const response = c.response ? read(c.response) : undefined;
      if (a.actualInput !== undefined) {
        const u = response?.usage;
        if (
          !u ||
          u.input + u.cacheRead + u.cacheWrite !== a.actualInput ||
          u.output !== a.actualOutput
        )
          mismatches.push(`usage mismatch ${c.id}`);
        else if (!a.usage) a.usage = u; // Recovered historical split, never mutate old ledger.
      }
      links.push({
        domain,
        started: a.started,
        call: c.id,
        logicalKey: c.logical_key,
        scope: c.scope,
        purpose: context?.purpose,
        stream: context?.loop_id,
        summaryJobState:
          summaryJob?.record_type === "CompactionJob"
            ? summaryJob.state
            : undefined,
        state: c.state,
        transportAttempt: c.transport_attempt,
        role: a.role,
        phase: a.phase,
        kind: a.kind,
        responseId: a.responseId,
      });
    }
    for (const c of calls.filter((c) => !used.has(c.id)))
      mismatches.push(
        `Core call without physical attempt ${domain}:${c.id}:${c.error ?? c.state}`,
      );
  }
  const group = (key: "role" | "phase" | "kind") =>
    Object.fromEntries(
      [...new Set(attempts.map((a) => a[key] ?? "unknown"))].map((value) => [
        value,
        totals(attempts.filter((a) => (a[key] ?? "unknown") === value)),
      ]),
    );
  const current = attempts.filter((a) => (a.domain ?? root) === root);
  const historical = attempts.filter((a) => (a.domain ?? root) !== root);
  const proposals = (all: boolean) =>
    ledger.batches
      .filter((b) => all || (b.domain ?? root) === root)
      .reduce(
        (n, b) => ({
          generated:
            n.generated +
            b.names.filter((name) => name === "task_propose").length,
          admitted:
            n.admitted +
            (b.admitted
              ? b.names.filter((name) => name === "task_propose").length
              : 0),
        }),
        { generated: 0, admitted: 0 },
      );
  const report = {
    at: new Date().toISOString(),
    head: manifest.head,
    policy: ledger.policy ?? "bounded",
    measurement:
      "Acceptance configuration: Main 90K, max output 8192, wire guard 100K; not production-default consumption.",
    reconciliation: {
      status: mismatches.length ? "FAIL" : "PASS",
      mismatches,
      links,
      logicalCalls: new Set(links.map((l) => l.domain + ":" + l.logicalKey))
        .size,
      streams: new Set(links.map((l) => l.domain + ":" + l.stream)).size,
    },
    current: totals(current),
    historical: totals(historical),
    combinedMixedPolicy: totals(attempts),
    byRole: group("role"),
    byPhase: group("phase"),
    byKind: group("kind"),
    staleMaintenance: { jobs: staleJobs.size, ...totals(staleAttempts) },
    proposals: { current: proposals(false), combined: proposals(true) },
    prices: {
      source: "https://api-docs.deepseek.com/quick_start/pricing/",
      checkedDate: "2026-11-05",
      peakPerMillion: { miss: 0.3, hit: 0.006, output: 1.2 },
      offPeakMultiplier: 0.5,
      caveat:
        "Weekday peak windows use peak even on a Chinese holiday; tariff uses admission timestamp. Unknown usage excluded from estimates but retained in exposure. Not an invoice.",
    },
    note: "Reported token totals exclude unknown usage. Reasoning is already within output. conservativeUSD is peak cache-miss exposure, not a bill. Historical cache splits are hash-checked against Core responses.",
  };
  fs.writeFileSync(
    path.join(root, "token-usage.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  const lines = [
    "# Token 消耗报告",
    "",
    report.measurement,
    "",
    `候选：${report.head}；对账：${report.reconciliation.status}。`,
    "",
    "| 范围 | HTTP 请求 | 输入（含缓存） | 输出（含推理） | 未知用量请求 |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const [name, t] of Object.entries({
    本轮: report.current,
    历史: report.historical,
    累计: report.combinedMixedPolicy,
  }))
    lines.push(
      `| ${name} | ${t.physicalRequests} | ${t.reportedInput} | ${t.reportedOutput} | ${t.unknownUsageRequests} |`,
    );
  lines.push(
    "",
    "| 用途（含历史） | HTTP 请求 | 输入 | 输出 | 缓存读取 | 推理（已含于输出） |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const [name, t] of Object.entries(report.byKind))
    lines.push(
      `| ${name} | ${t.physicalRequests} | ${t.reportedInput} | ${t.reportedOutput} | ${t.cacheRead} | ${t.reasoningWithinOutput} |`,
    );
  lines.push(
    "",
    report.note,
    `STALE 摘要：${report.staleMaintenance.jobs} 个 Job，${report.staleMaintenance.physicalRequests} 次物理请求，输入 ${report.staleMaintenance.reportedInput} / 输出 ${report.staleMaintenance.reportedOutput} tokens；未知用量 ${report.staleMaintenance.unknownUsageRequests} 次。限速不代表保证收敛。`,
    "",
    "逐请求归属、逻辑调用、角色及阶段统计见同目录 token-usage.json。",
    "",
  );
  fs.writeFileSync(path.join(root, "TOKEN-USAGE.md"), lines.join("\n"), {
    mode: 0o600,
  });
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const report = usageReport(process.argv[2]);
  console.log(
    JSON.stringify({
      current: report.current,
      combined: report.combinedMixedPolicy,
      reconciliation: report.reconciliation.status,
    }),
  );
  if (report.reconciliation.status !== "PASS") process.exitCode = 1;
}
