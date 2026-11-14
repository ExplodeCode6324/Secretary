#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { args, privateJSON, fail } from "./io.mjs";
import { readSnapshot } from "./snapshot-reader.mjs";
import { usageReport, memoryReport } from "./reports.mjs";
export async function main(argv) {
  const o = args(argv, [
    "snapshot",
    "output",
    "from",
    "to",
    "timezone",
    "task",
    "execution",
    "max-journal-bytes",
    "max-cas-bytes",
    "max-milliseconds",
  ]);
  if (!["usage", "memory"].includes(o.command) || !o.snapshot || !o.output)
    fail("USAGE_REQUIRES_SNAPSHOT_AND_OUTPUT");
  const limits = {};
  for (const [flag, key] of [
    ["max-journal-bytes", "journal"],
    ["max-cas-bytes", "cas"],
    ["max-milliseconds", "milliseconds"],
  ])
    if (o[flag]) limits[key] = Number(o[flag]);
  const s = await readSnapshot(o.snapshot, limits),
    report = o.command === "usage" ? usageReport(s, o) : memoryReport(s);
  privateJSON(o.output, report, {
    forbidden: [
      s.root,
      ...["core", "postgres", "tui"].map((x) =>
        path.join(s.manifest.source_root, "data", x),
      ),
    ],
  });
  console.log(
    JSON.stringify({
      status: "COMPLETE",
      kind: o.command,
      sequence: report.read.sequence,
      source_unchanged: true,
    }),
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2)).catch((e) => {
    console.error(
      JSON.stringify({
        status: "INCOMPLETE",
        code: /^[A-Z_]+$/.test(e.message) ? e.message : "INVALID_INPUT",
      }),
    );
    process.exitCode = 1;
  });
