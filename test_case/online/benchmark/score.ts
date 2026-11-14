import fs from "node:fs";
import path from "node:path";
import type { Domains } from "./domain.ts";
import { assertCampaignClosed } from "./campaign.ts";
import { validateVerdicts } from "./grading.ts";
import { auditEpisode } from "./evidence-audit.ts";
import { scorePublicComponents } from "./public-score.ts";
import { scorePublicGrades } from "./public-grading.ts";
import {
  readJSON,
  read,
  requireThat,
  sha,
  writeJSON,
  processStatus,
} from "./io.ts";

const severityOrder = ["S1", "S2", "S3", "S4"];
/** Rescores are not fresh runs. Ambiguous repeated judgments never increase N. */
export function summarizeJudgments(rows: any[]) {
  const groups = new Map<string, any>();
  for (const row of rows) {
    const key = JSON.stringify([
      row.model,
      row.profile,
      row.family,
      row.version,
    ]);
    if (!groups.has(key))
      groups.set(key, {
        model: row.model,
        profile: row.profile,
        family: row.family,
        version: row.version,
        by_run: new Map<string, any[]>(),
      });
    const group = groups.get(key),
      judgments = group.by_run.get(row.run) ?? [];
    if (!judgments.some((j: any) => j.judgment_sha256 === row.judgment_sha256))
      judgments.push(row);
    group.by_run.set(row.run, judgments);
  }
  return [...groups.values()].map(({ by_run, ...group }) => {
    const unambiguous = [...by_run.values()]
      .filter((j: any) => j.length === 1)
      .map((j: any) => j[0]);
    const counts = Object.fromEntries(
      [...severityOrder, "NO_ASSERTION_FAILURE"].map((s) => [s, 0]),
    );
    for (const row of unambiguous) {
      const worst = severityOrder.find((s) =>
        row.verdicts.some((v: any) => v.label === "FAIL" && v.severity === s),
      );
      counts[worst ?? "NO_ASSERTION_FAILURE"]++;
    }
    return {
      ...group,
      distinct_runs_with_judgments: by_run.size,
      ambiguous_runs: by_run.size - unambiguous.length,
      runs_with_any_failure_candidate: [...by_run.values()].filter(
        (judgments: any) =>
          judgments.some((r: any) =>
            r.verdicts.some((v: any) => v.label === "FAIL"),
          ),
      ).length,
      provisional_worst_severity_counts: counts,
      runs_with_unresolved_assertions: unambiguous.filter((r: any) =>
        r.verdicts.some((v: any) => v.label === "UNRESOLVED"),
      ).length,
      human_review_flagged_runs: unambiguous.filter((r: any) =>
        r.verdicts.some((v: any) => v.human_review),
      ).length,
      qualification: "NOT_EVALUATED_PENDING_FREEZE_CONTROLS_AND_HUMAN_REVIEW",
    };
  });
}

export function scoreDevelopment(d: Domains) {
  assertCampaignClosed(d.root);
  const runs = fs
    .readdirSync(path.join(d.root, "runs"))
    .filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))
    .map((n) => d.load(n.slice(0, -5)));
  requireThat(
    runs.every(
      (r) =>
        ["STOPPED", "RETIRED", "CLEANED"].includes(r.state) &&
        (!r.process || processStatus(r.process) === "STOPPED"),
    ),
    "SCORE_REQUIRES_STOPPED_FACILITY",
  );
  const leaves = runs.filter(
    (r) =>
      r.config.mode === "live" && !runs.some((child) => child.parent === r.id),
  );
  const receipts: any[] = [],
    coverage: any[] = [];
  const oracleFiles = fs.readdirSync(path.join(d.root, "oracles"));
  for (const run of leaves) {
    if (run.config.mode !== "live") continue;
    const originalPath = path.join(
      d.root,
      "oracles",
      run.id + "-grade-packet.json",
    );
    if (!fs.existsSync(originalPath)) {
      coverage.push({
        run: run.id,
        lineage: run.lineage,
        case_id: run.config.case_id,
        status: "MISSING_TRAJECTORY_PACKET",
      });
      continue;
    }
    const original = readJSON(originalPath);
    const audit = run.state === "CLEANED" ? null : auditEpisode(run).audit;
    const packets = ["-sealed.json", "-sealed-v2.json"]
      .map((s) => path.join(d.root, "oracles", run.id + s))
      .filter((f) => fs.existsSync(f))
      .map((f) => readJSON(f));
    const files = oracleFiles.filter(
      (n) =>
        n.startsWith(run.id + "-verdict-") &&
        /^[a-f0-9-]{36}-verdict-[a-f0-9-]{36}\.json$/.test(n),
    );
    coverage.push({
      run: run.id,
      lineage: run.lineage,
      case_id: run.config.case_id,
      model: run.config.model,
      profile: run.config.profile,
      family: original.episode.family,
      driver_failure: original.infrastructure_failure ?? null,
      maintenance: audit?.maintenance.status ?? "NOT_AUDITED_CLEANED_RUN",
      maintenance_first_failure: audit?.maintenance.first_failure ?? null,
      verdict_receipts: files.length,
      source_artifact_sha256: sha(read(originalPath)),
      status: files.length
        ? "ADVISORY_JUDGMENTS_PRESENT"
        : "ADJUDICATION_PENDING",
    });
    for (const name of files) {
      const receipt = readJSON(path.join(d.root, "oracles", name));
      const {
        received_at,
        qualification,
        source_sha256,
        source_file_sha256,
        ...submission
      } = receipt;
      requireThat(
        source_sha256 === sha(JSON.stringify(submission)),
        "GRADE_RECEIPT_CHANGED",
      );
      const packet = packets.find((p) => p.packet_id === submission.packet_id);
      requireThat(packet, "GRADE_PACKET_MISSING");
      validateVerdicts(packet, submission);
      receipts.push({
        run: run.id,
        lineage: run.lineage,
        model: run.config.model,
        profile: run.config.profile,
        family: original.episode.family,
        version: packet.payload.version,
        packet_id: packet.packet_id,
        judgment_sha256: source_sha256,
        receipt_file: name,
        received_at,
        qualification,
        verdicts: submission.verdicts,
        notes: submission.notes ?? [],
      });
    }
  }
  const planned = fs
    .readdirSync(path.join(d.root, "reports"))
    .filter((n) => /^[a-f0-9-]{36}$/.test(n))
    .map((n) => path.join(d.root, "reports", n, "report.json"))
    .filter((f) => fs.existsSync(f))
    .map((f) => ({
      report_file: f,
      sha256: sha(read(f)),
      cases: readJSON(f).cases,
    }));
  const result = {
    version: "secretary-memory-descriptive-score-v1",
    planned_reports: planned,
    run_coverage: coverage,
    judgment_history: receipts,
    public_components: scorePublicComponents(d.root, runs),
    public_qa: scorePublicGrades(d.root),
    groups: summarizeJudgments(receipts),
    limitations: [
      "Provisional judge observations only; no approved tolerance gate or reliability claim",
      "NO_ASSERTION_FAILURE refers only to the selected assertion labels, not mechanical completion or an absence of errors in judgment notes",
      "V1/V2 rescores and checkpoint descendants are not independent repeats",
      "Missing trajectory/report evidence remains explicit; no invented planned denominator",
      "Recurrence and root-cause adjudication are pending; never infer them from free-text rationale",
    ],
    qualification: "NOT_EVALUATED",
  };
  const file = path.join(
    d.root,
    "reports",
    "score-" + sha(JSON.stringify(result)) + ".json",
  );
  if (!fs.existsSync(file)) writeJSON(file, result);
  return {
    file,
    groups: result.groups,
    run_coverage: coverage,
    qualification: result.qualification,
  };
}
