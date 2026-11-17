import path from "node:path";
import { ledger } from "./campaign.ts";
import { requireThat, writeJSON } from "./io.ts";
import {
  validateReport,
  type Report,
  type CaseResult,
} from "../../benchmarks/common/report.ts";

/** Persist every planned row before dispatch; interrupted attempts cannot shrink it. */
export async function runMatrix<T extends { id: string }>(
  root: string,
  report: Report,
  rows: T[],
  execute: (
    row: T,
  ) => Promise<{ result: CaseResult; first_failure: string | null }>,
) {
  requireThat(
    rows.length > 0 && new Set(rows.map((r) => r.id)).size === rows.length,
    "PILOT_MATRIX_INVALID",
  );
  report.cases = rows.map((r) => ({
    id: r.id,
    status: "NOT_TESTED",
    evidence: [],
    reason: "Planned; not yet attempted",
  }));
  const save = () => {
    report.finished_at = new Date().toISOString();
    const sends = ledger(root).entries.size;
    report.metrics.physical_provider_sends = sends;
    if (sends > 0)
      report.evidence_classes = ["REAL_MODEL", "REAL_PROCESS", "REAL_POSTGRES"];
    writeJSON(
      path.join(root, "reports", report.run_id, "report.json"),
      validateReport(report),
    );
  };
  save();
  for (const [index, row] of rows.entries()) {
    report.cases[index] = {
      id: row.id,
      status: "INCOMPLETE",
      evidence: [root],
      reason: "Attempt started; outcome not yet recorded",
    };
    save();
    try {
      const outcome = await execute(row);
      requireThat(outcome.result.id === row.id, "PILOT_ROW_ID_CHANGED");
      report.first_failure ??= outcome.first_failure;
      report.cases[index] = outcome.result;
    } catch (error) {
      const failure =
        error instanceof Error ? error.message : "PILOT_UNEXPECTED_FAILURE";
      report.first_failure ??= failure;
      report.cases[index] = {
        id: row.id,
        status: "INCOMPLETE",
        evidence: [root],
        reason: failure,
      };
      // A create/stop/finalization error may leave a resource uncertain. Do not
      // dispatch another row while pretending that cleanup or isolation passed.
      for (let next = index + 1; next < rows.length; next++)
        report.cases[next].reason =
          "Not attempted after prior row failed to finalize: " + failure;
      save();
      break;
    }
    save();
  }
  return report;
}
