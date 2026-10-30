/** Export current v2 content for a separately authorized old-client rollback. */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { LocalFiles, exportLegacyState } from "../src/tui/state.ts";
const args = process.argv.slice(2);
if (args.length !== 2)
  throw Error(
    "Usage: npx tsx src/pi_secretary/scripts/tui-export-v1.ts <state-directory> <new-output-file>",
  );
const directory = path.resolve(args[0]),
  output = path.resolve(args[1]);
const original = JSON.parse(
  await fs.readFile(path.join(directory, "state.json"), "utf8"),
);
const files = new LocalFiles(directory);
const temporary = output + ".tmp-" + randomUUID();
try {
  const current = await files.open(original.domain, original.mode);
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(exportLegacyState(current)));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.link(temporary, output); // Never replace a current draft or an earlier export.
  console.log(
    "Exported current drafts and immutable pending request to " + output,
  );
} finally {
  await fs.unlink(temporary).catch(() => {});
  await files.close();
}
