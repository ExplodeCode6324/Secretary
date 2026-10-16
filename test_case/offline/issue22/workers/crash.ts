import fs from "node:fs";
import path from "node:path";
import { App } from "../../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../../src/pi_secretary/src/model.ts";
import { base, id } from "../../../../src/pi_secretary/src/store.ts";
import { sendPush } from "../../../../src/pi_secretary/src/push-transport.ts";
import { config } from "../helpers.ts";
const [dir, endpoint, phase] = process.argv.slice(2);
const app = await App.open(
  dir,
  { model: fixtureModel, stream: fixtureStream },
  undefined,
  {
    clock: () => Date.parse("2030-01-01T12:00:00Z"),
    pushDelivery: async (...args) => {
      await sendPush(...args);
      process.kill(process.pid, "SIGKILL");
    },
  },
);
const t = app.pushes.configure(config(endpoint));
fs.mkdirSync(path.join(dir, "push-secrets"), { mode: 0o700 });
fs.writeFileSync(
  path.join(dir, "push-secrets", t.id + ".json"),
  JSON.stringify({ topic: "synthetic-crash" }),
  { mode: 0o600 },
);
app.store.commit([
  {
    ...base(),
    schema_version: 1,
    record_type: "Notification",
    state: "QUEUED",
    session_id: app.host.sessionID,
    channel: "local-ui",
    message: app.store.put("crash notification", "text/plain"),
    delivery_key: id(),
    receipt: null,
    requested_at: new Date().toISOString(),
  },
]);
if (phase === "notification") process.kill(process.pid, "SIGKILL");
if (phase === "sending") {
  const owner = (app.store as any).owner;
  const append = owner.append.bind(owner);
  owner.append = (frame: string, digest: string) => {
    append(frame, digest);
    const tx = JSON.parse(
      Buffer.from(JSON.parse(frame).payload_b64, "base64").toString(),
    );
    if (
      tx.mutations.some((m: any) => m.object_type === "PushDispatch") &&
      app.store.all<any>("PushDispatch").some((d: any) => d.state === "PENDING")
    )
      process.kill(process.pid, "SIGKILL");
  };
}
await app.pushes.tick();
throw Error("CRASH_NOT_INJECTED");
