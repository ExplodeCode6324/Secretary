import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const dir = path.resolve(
  process.env.SECRETARY_DESKTOP_TEST_DATA ??
    path.join(repo, ".demo-data/issue59-native"),
);
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.chmodSync(dir, 0o700);
fs.writeFileSync(
  path.join(dir, "profiles.json"),
  JSON.stringify([
    {
      id: "fixture",
      data_dir: path.join(dir, "core"),
      expected_mode: "fixture",
      node_abs: process.execPath,
      core_root: repo,
      backend_entry: path.join(repo, "src/pi_secretary/src/backend.ts"),
    },
  ]),
  { mode: 0o600 },
);
console.log("Prepared isolated native bridge fixture");
