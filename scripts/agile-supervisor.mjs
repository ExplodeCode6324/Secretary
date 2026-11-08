import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
process.umask(0o077);
// Sequential probes: never overlap startup or create another data domain.
// No request count, tool count, runtime deadline or automatic maintenance stop.
for (;;) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/agile.mjs", "ensure"], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) console.error(JSON.stringify({ at: new Date().toISOString(), event: "agile-recovery-retry", status: result.status, error: result.error?.code }));
  await setTimeout(30_000);
}
