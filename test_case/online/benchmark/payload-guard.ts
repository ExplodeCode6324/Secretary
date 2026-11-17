import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { readJSON, requireThat, writeJSON } from "./io.ts";

// Controller-only files, outside checkpoints and the SUT tool workspace. These
// detect exact contamination, not semantic paraphrases or an adversarial OS escape.
const file = (root: string, lineage: string) => {
  requireThat(/^[a-f0-9-]{36}$/.test(lineage), "GUARD_LINEAGE_INVALID");
  return path.join(root, "campaign/guards", lineage + ".json");
};
export function initializeGuard(root: string, lineage: string) {
  const target = file(root, lineage);
  requireThat(!fs.existsSync(target), "GUARD_ALREADY_EXISTS");
  const oracleCanary = "PRIVATE_ORACLE_CANARY_" + randomUUID();
  writeJSON(target, {
    version: 1,
    lineage,
    oracle_canary: oracleCanary,
    future: [],
  });
  return oracleCanary;
}
export function setFutureInputs(
  root: string,
  lineage: string,
  future: string[],
) {
  const target = file(root, lineage),
    value = readJSON(target);
  requireThat(
    value.version === 1 &&
      value.lineage === lineage &&
      future.every((s) => typeof s === "string" && s.length > 0),
    "GUARD_INVALID",
  );
  writeJSON(target, { ...value, future });
}
export function forbiddenPayload(root: string, lineage: string): string[] {
  const value = readJSON(file(root, lineage));
  requireThat(
    value.version === 1 &&
      value.lineage === lineage &&
      typeof value.oracle_canary === "string" &&
      value.oracle_canary.startsWith("PRIVATE_ORACLE_CANARY_") &&
      Array.isArray(value.future) &&
      value.future.every((s: unknown) => typeof s === "string" && s.length > 0),
    "GUARD_INVALID",
  );
  return [value.oracle_canary, ...value.future];
}
