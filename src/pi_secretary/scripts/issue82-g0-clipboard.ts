// Explicit synthetic clipboard setup/roundtrip for the G0 operator. No UI claim.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PASTE_START as S, PASTE_END as E } from "./issue82-g0/input.ts";
const fixtures: Record<string, string> = {
  benign: "中文 😀 e\u0301\tA\r\nB\rC\n/send literal",
  "end-controls": "abc" + E + "\x13\x07\x03",
  nested: "abc" + S + "def" + E + "\x13\x07\x03",
  duplicate: "abc" + E + E + "\x13\x07\x03",
  large: "中文😀".repeat(3000) + E + "\x13\x07\x03",
};
const fixture = process.argv[2];
if (!fixture || !(fixture in fixtures) || process.argv.length !== 3) {
  console.log(
    "Usage: node --import tsx src/pi_secretary/scripts/issue82-g0-clipboard.ts benign|end-controls|nested|duplicate|large\nReplaces clipboard with synthetic fixture and checks UTF-8 roundtrip; does not paste into a terminal.",
  );
  process.exit(fixture === "--help" ? 0 : 1);
}
const text = fixtures[fixture]!;
const env = {
  PATH: "/usr/bin:/bin",
  LANG: "en_US.UTF-8",
  LC_CTYPE: "en_US.UTF-8",
};
const put = spawnSync("/usr/bin/pbcopy", [], {
  input: text,
  encoding: "utf8",
  env,
  timeout: 2000,
  maxBuffer: 128 * 1024,
});
const get =
  put.status === 0
    ? spawnSync("/usr/bin/pbpaste", [], {
        encoding: "utf8",
        env,
        timeout: 2000,
        maxBuffer: 128 * 1024,
      })
    : undefined;
const report = {
  at: new Date().toISOString(),
  fixture,
  bytes: Buffer.byteLength(text),
  putStatus: put.status,
  getStatus: get?.status,
  error: put.error?.message ?? get?.error?.message,
  exactRoundtrip: get?.status === 0 && get.stdout === text,
  terminalPaste: "NOT_TESTED",
};
const root = fileURLToPath(
  new URL("../../../.demo-data/issue82-tui/g0/", import.meta.url),
);
mkdirSync(root, { recursive: true, mode: 0o700 });
writeFileSync(
  `${root}clipboard-${Date.now()}.json`,
  JSON.stringify(report, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.exactRoundtrip ? 0 : 1;
