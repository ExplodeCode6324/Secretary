// Explicit interactive OS acceptance fixture. Only synthetic data in a fresh private directory.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { App } from "../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../src/pi_secretary/src/api-v1.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../src/pi_secretary/src/model.ts";
import { base, id } from "../../src/pi_secretary/src/store.ts";
import type { Notification } from "../../src/pi_secretary/src/contracts.ts";
const root = path.resolve(process.argv[2] ?? "");
assert(
  process.argv[2] && !fs.existsSync(root),
  "fresh private directory required",
);
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const app = await App.open(path.join(root, "core"), {
  model: fixtureModel,
  stream: fixtureStream,
});
const server = await serveCore(app, 0, undefined, { pump: true });
fs.writeFileSync(
  path.join(root, "core/core-endpoint.json"),
  JSON.stringify(server.endpoint),
  { mode: 0o600 },
);
let prior = "";
const notices: string[] = [];
const timer = setInterval(() => {
  const control = path.join(root, "control.json");
  if (fs.existsSync(control)) {
    const raw = fs.readFileSync(control, "utf8");
    if (raw !== prior) {
      prior = raw;
      const command = JSON.parse(raw);
      if (command.action === "notice") {
        const notice: Notification = {
          ...base(),
          schema_version: 1,
          record_type: "Notification",
          session_id: app.host.sessionID,
          channel: "local-ui",
          state: "QUEUED",
          message: app.store.put(
            "PR3c synthetic " + String(command.label),
            "text/plain",
          ),
          delivery_key: id(),
          receipt: null,
          requested_at: new Date().toISOString(),
        };
        app.store.commit([notice]);
        notices.push(notice.id);
      }
    }
  }
  fs.writeFileSync(
    path.join(root, "state.json.tmp"),
    JSON.stringify({
      notices,
      events: app.store.logs.filter((e) =>
        e.event_type.startsWith("notification."),
      ),
    }),
  );
  fs.renameSync(
    path.join(root, "state.json.tmp"),
    path.join(root, "state.json"),
  );
}, 100);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    clearInterval(timer);
    await server.close();
    process.exit(0);
  });
console.log("Ready: isolated synthetic OS fixture");
