import path from "node:path";
import { randomUUID } from "node:crypto";
import { attachCore, startCore } from "./core-client.ts";
const directory = path.resolve(process.env.SECRETARY_DATA ?? ".demo-data");
const command = process.argv[2] ?? "status";
if (!["start", "attach", "status", "stop"].includes(command))
  throw Error("Usage: core start|attach|status|stop");
const client =
  command === "start"
    ? await startCore(directory)
    : await attachCore(directory);
if (!client) {
  console.log(JSON.stringify({ state: "STOPPED" }));
  process.exitCode = command === "stop" ? 0 : 1;
} else if (command === "stop")
  console.log(
    JSON.stringify(
      await client.command("core/stop", { request_id: randomUUID() }),
    ),
  );
else console.log(JSON.stringify(await client.core()));
