/** Explicit, read-only full CAS audit. Run against a stopped Core directory. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const directory = process.argv[2];
if (!directory)
  throw Error(
    "Usage: npx tsx src/pi_secretary/scripts/verify-cas.ts DATA_DIRECTORY",
  );
let checked = 0,
  corrupt = 0;
for (const entry of fs.readdirSync(path.join(directory, "objects"))) {
  const file = path.join(directory, "objects", entry);
  if (!/^[a-f0-9]{64}$/.test(entry)) continue;
  const stat = fs.lstatSync(file);
  let valid = stat.isFile() && !stat.isSymbolicLink();
  if (valid) {
    const hash = createHash("sha256");
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    valid = hash.digest("hex") === entry;
  }
  checked++;
  if (!valid) {
    corrupt++;
    console.error("CORRUPT_OBJECT " + entry);
  }
}
console.log(JSON.stringify({ checked, corrupt }));
if (corrupt) process.exitCode = 1;
