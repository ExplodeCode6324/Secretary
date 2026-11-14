import fs from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import os from "node:os";
import { requireThat } from "../../online/benchmark/io.ts";

export const statuses = [
  "PASS",
  "FAIL",
  "NOT_TESTED",
  "BLOCKED",
  "INCOMPLETE",
  "NOT_APPLICABLE",
] as const;
export type Status = (typeof statuses)[number];
export type CaseResult = {
  id: string;
  status: Status;
  evidence: string[];
  reason?: string;
};
export interface Report {
  schema: "secretary-test-report-v1";
  run_id: string;
  track: "correctness" | "memory";
  source: Record<string, unknown>;
  configuration: Record<string, unknown>;
  started_at: string;
  finished_at: string;
  cases: CaseResult[];
  evidence_classes: string[];
  metrics: Record<string, unknown>;
  limitations: string[];
  first_failure: string | null;
  machine: Record<string, unknown>;
}
const schemaValidator = new Ajv2020().compile(
  JSON.parse(
    fs.readFileSync(new URL("./report.schema.json", import.meta.url), "utf8"),
  ),
);
export function validateReport(r: Report) {
  requireThat(schemaValidator(r), "REPORT_SCHEMA_INVALID");
  requireThat(
    r.schema === "secretary-test-report-v1" &&
      ["correctness", "memory"].includes(r.track) &&
      r.run_id,
    "INVALID_REPORT",
  );
  requireThat(
    Number.isFinite(Date.parse(r.started_at)) &&
      Number.isFinite(Date.parse(r.finished_at)) &&
      Date.parse(r.finished_at) >= Date.parse(r.started_at),
    "INVALID_REPORT_TIME",
  );
  requireThat(
    r.cases.length > 0 &&
      new Set(r.cases.map((c) => c.id)).size === r.cases.length,
    "INVALID_CASE_DENOMINATOR",
  );
  for (const c of r.cases)
    requireThat(
      statuses.includes(c.status) &&
        Array.isArray(c.evidence) &&
        (c.status === "PASS" ? c.evidence.length > 0 : !!c.reason),
      "INVALID_CASE_RESULT",
    );
  requireThat(
    !r.cases.some((c) => c.status === "FAIL") || !!r.first_failure,
    "MISSING_FIRST_FAILURE",
  );
  requireThat(
    r.track !== "memory" ||
      r.evidence_classes.includes("REAL_MODEL") ||
      !r.cases.some((c) => c.status === "PASS"),
    "SCRIPTED_MEMORY_CLAIM",
  );
  return r;
}
export function totals(r: Report) {
  validateReport(r);
  return Object.fromEntries(
    statuses.map((s) => [s, r.cases.filter((c) => c.status === s).length]),
  );
}
export function markdown(r: Report) {
  const counts = totals(r);
  const clean = (x: string) => x.replaceAll("|", "\\|").replaceAll("\n", " ");
  return `# Test report — ${r.run_id}\n\nTrack: ${r.track}. Evidence: ${r.evidence_classes.join(", ")}.\n\nPlanned: ${r.cases.length}; executed: ${r.cases.filter((c) => ["PASS", "FAIL"].includes(c.status)).length}; ${Object.entries(
    counts,
  )
    .map(([s, n]) => `${s}: ${n}`)
    .join(
      "; ",
    )}.\n\n| Case | Status | Evidence / reason |\n| --- | --- | --- |\n${r.cases.map((c) => `| ${clean(c.id)} | ${c.status} | ${clean(c.reason ?? c.evidence.join(", "))} |`).join("\n")}\n\nFirst failure: ${clean(r.first_failure ?? "none")}\n\n${r.limitations.map((l) => "- " + l).join("\n")}\n`;
}
export function machine() {
  return {
    os: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpu: os.cpus()[0]?.model,
    logical_cpus: os.cpus().length,
    ram_bytes: os.totalmem(),
    node: process.version,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
