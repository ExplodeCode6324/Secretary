import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { App } from "./app.ts";
import { serveCore } from "./api-v1.ts";
// Retained read projection is tested independently; it is not an HTTP protocol.
export { conversation } from "./conversation.ts";
export { serveCore as serve } from "./api-v1.ts";
export async function runCore(directory: string) {
  const app = await App.open(
    directory,
    undefined,
    process.env.SECRETARY_DATABASE_URL,
  );
  const file = path.join(directory, "core-endpoint.json");
  let stopping = false;
  const backend = await serveCore(app, 0, () => void stop());
  const temp = file + "." + process.pid;
  fs.writeFileSync(temp, JSON.stringify(backend.endpoint), {
    mode: 0o600,
    flag: "wx",
  });
  fs.renameSync(temp, file);
  async function stop() {
    if (stopping) return;
    stopping = true;
    // Remove only our discovery record, while still holding the writer lock.
    try {
      if (
        JSON.parse(fs.readFileSync(file, "utf8")).instance_id ===
        backend.endpoint.instance_id
      )
        fs.unlinkSync(file);
    } catch {}
    await backend.close();
  }
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
  return backend;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await runCore(path.resolve(process.env.SECRETARY_DATA ?? ".demo-data"));
