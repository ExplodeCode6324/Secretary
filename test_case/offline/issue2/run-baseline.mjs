import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const output = path.resolve(
  root,
  process.argv[2] ?? "test_case/reports/issue2-context-memory-baseline",
);
if (fs.existsSync(path.join(output, "focused-results.json"))) {
  throw Error(
    "Refusing to overwrite saved baseline; choose a NEW output directory.",
  );
}
fs.mkdirSync(output, { recursive: true });
const env = { ...process.env };
for (const key of Object.keys(env))
  if (key.startsWith("SECRETARY_")) delete env[key];
const git = (...args) =>
  spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout.trim();
const tracked = git(
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
  "src/pi_secretary",
  "src/contracts",
  "package.json",
  "package-lock.json",
)
  .split("\n")
  .filter(Boolean);
const suite = fs
  .readdirSync(path.join(root, "test_case/offline/issue2"))
  .filter((name) => /\.(ts|mjs)$/.test(name))
  .map((name) => "test_case/offline/issue2/" + name);
function hashes(files) {
  return Object.fromEntries(
    files
      .sort()
      .filter((file) => fs.statSync(path.join(root, file)).isFile())
      .map((file) => [
        file,
        crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join(root, file)))
          .digest("hex"),
      ]),
  );
}
const before = hashes(tracked);
const started = new Date().toISOString();
const common = {
  cwd: root,
  env,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
  timeout: 180_000,
};
const typeArgs = [
  "node_modules/typescript/bin/tsc",
  "--noEmit",
  "--target",
  "ES2023",
  "--module",
  "NodeNext",
  "--moduleResolution",
  "NodeNext",
  "--allowImportingTsExtensions",
  "--strict",
  "--skipLibCheck",
  "--esModuleInterop",
  "--resolveJsonModule",
  "test_case/offline/issue2/context-memory.test.ts",
];
const typecheck = spawnSync(process.execPath, typeArgs, common);
fs.writeFileSync(
  path.join(output, "focused-typecheck.log"),
  typecheck.stdout + typecheck.stderr,
);
const args = [
  "node_modules/tsx/dist/cli.mjs",
  "--test",
  "--test-reporter=tap",
  "--test-timeout=15000",
  "test_case/offline/issue2/context-memory.test.ts",
];
const result = spawnSync(process.execPath, args, common);
const tap = result.stdout ?? "";
fs.writeFileSync(path.join(output, "focused.tap"), tap);
fs.writeFileSync(path.join(output, "focused.stderr.log"), result.stderr ?? "");
const tests = [
  ...tap.matchAll(/^(not ok|ok) \d+ - ((?:INV|GOAL)-\d+[^\n]*)/gm),
].map((match) => ({
  name: match[2],
  status: match[1] === "ok" ? "pass" : "fail",
}));
const firstFailures = tests
  .filter((test) => test.status === "fail")
  .map((test) => {
    const offset = tap.indexOf("- " + test.name);
    const end = tap.indexOf("\n# Subtest:", offset);
    return {
      name: test.name,
      tap: tap.slice(offset, end < 0 ? undefined : end).trim(),
    };
  });
const after = hashes(tracked);
const report = {
  started_utc: started,
  completed_utc: new Date().toISOString(),
  timezone: "Asia/Hong_Kong",
  head: git("rev-parse", "HEAD"),
  pi_submodule_head: git("-C", "src/pi_resource", "rev-parse", "HEAD"),
  node: process.version,
  source_hashes: before,
  suite_hashes: hashes(suite),
  source_unchanged_during_run: JSON.stringify(before) === JSON.stringify(after),
  environment:
    "All SECRETARY_* overrides removed; synthetic injected Model/StreamFn; fresh temp directory per test; no real provider, network, credentials or private data used.",
  command: [process.execPath, ...args],
  typecheck_command: [process.execPath, ...typeArgs],
  typecheck_exit_code: typecheck.status,
  typecheck_error: typecheck.error?.message ?? null,
  exit_code: result.status,
  signal: result.signal,
  error: result.error?.message ?? null,
  totals: {
    tests: tests.length,
    pass: tests.filter((test) => test.status === "pass").length,
    fail: tests.filter((test) => test.status === "fail").length,
  },
  invariant: tests.filter((test) => test.name.startsWith("INV-")),
  desired_behavior: tests.filter((test) => test.name.startsWith("GOAL-")),
  first_failures: firstFailures,
};
fs.writeFileSync(
  path.join(output, "focused-results.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      typecheck: report.typecheck_exit_code,
      exit: report.exit_code,
      ...report.totals,
      source_unchanged: report.source_unchanged_during_run,
      output,
    },
    null,
    2,
  ),
);
process.exitCode = typecheck.status !== 0 ? 2 : (result.status ?? 2);
