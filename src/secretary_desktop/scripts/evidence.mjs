import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
const allowed = ["window", "ime", "selection", "phase", "motion", "security"];
const name = process.argv[2];
if (!allowed.includes(name)) throw new Error("Choose " + allowed.join(", "));
const run = resolve(
  "../../.demo-data/issue58/runs",
  new Date().toISOString().replaceAll(":", "-") + "-" + name,
);
mkdirSync(run, { recursive: true });
if (name === "ime") {
  writeFileSync(
    run + "/index.json",
    JSON.stringify(
      {
        case: name,
        status: "NOT_TESTED",
        reason:
          "Requires real system IME. Run the seven manual cases from README, record native events and exact payload; synthetic WebDriver events are not IME acceptance.",
      },
      null,
      2,
    ),
  );
  console.log(run);
  process.exit(0);
}
const result =
  name === "security"
    ? spawnSync("node", ["scripts/security.mjs", run], { stdio: "inherit" })
    : spawnSync("npm", ["run", "test:native"], {
        stdio: "inherit",
        env: { ...process.env, STUDY_EVIDENCE_DIR: run, STUDY_CASE: name },
      });
writeFileSync(
  run + "/invocation.json",
  JSON.stringify(
    {
      case: name,
      status: result.status === 0 ? "PASS" : "FAIL",
      command:
        name === "security"
          ? "node scripts/security.mjs"
          : "npm run test:native (all native cases)",
      exit: result.status,
    },
    null,
    2,
  ),
);
if (!existsSync(run + "/index.json"))
  copyFileSync(run + "/invocation.json", run + "/index.json");
process.exit(result.status ?? 1);
