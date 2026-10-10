import fs from "node:fs";
import path from "node:path";
import { App } from "../../../../src/pi_secretary/src/app.ts";
import { ApplicationService } from "../../../../src/pi_secretary/src/application-service.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../../src/pi_secretary/src/model.ts";
import { id, revise, hash } from "../../../../src/pi_secretary/src/store.ts";
import { NotificationService } from "../../../../src/pi_secretary/src/notification-service.ts";
const [directory, phase, kind] = process.argv.slice(2);
const app = await App.open(directory, {
  model: fixtureModel,
  stream: fixtureStream,
});
const service = new ApplicationService(app),
  command = (route: string, body: any, binding?: string) =>
    service.command(service.principal, route, body, binding);
if (kind !== "initialize") command("sync/initialize", { request_id: id() });
let binding: string | undefined,
  route = "messages",
  body: any = { request_id: id(), text: "Synthetic restart input" };
if (kind === "ack") {
  const r = command("clients", { request_id: id(), name: "Crash fixture" }),
    client = r.resource_ids.find((r) => r.type === "ClientRegistration")!.id;
  command("clients/" + client + "/notification-target", {
    request_id: id(),
    enabled: true,
  });
  binding = service.synchronization.notifications.binding(
    client,
    service.identity.owner_id,
  );
  const n = new NotificationService(app.store).create(
    app.host.sessionID,
    "Durable synthetic notice",
    id(),
  );
  const d = app.store.all("NotificationDelivery")[0];
  route = "deliveries/" + d.id + "/ack";
  body = {
    request_id: id(),
    kind: "received",
    content_version: n.message.sha256,
  };
}
let legacyHash: string | undefined;
if (kind === "initialize") {
  const ns = new NotificationService(app.store);
  for (const state of [
    "QUEUED",
    "SENDING",
    "SENT",
    "FAILED",
    "DELIVERY_UNKNOWN",
  ] as const) {
    const n = ns.create(
      app.host.sessionID,
      "Synthetic historical " + state,
      id(),
    );
    if (state !== "QUEUED")
      app.store.commit([
        revise(n, {
          state,
          receipt:
            state === "SENT"
              ? app.store.put({ delivery_key: n.delivery_key, presented: true })
              : null,
        }),
      ]);
  }
  legacyHash = hash(JSON.stringify(app.store.all("Notification")));
  route = "sync/initialize";
  body = { request_id: id() };
}
const snapshot: any =
  kind === "initialize"
    ? null
    : await service.query(
        service.principal,
        "sync/bootstrap",
        new URLSearchParams(),
        binding,
      );
fs.writeFileSync(
  path.join(directory, "fixture.json"),
  JSON.stringify({ snapshot, route, body, binding, legacyHash }),
);
const owner = (app.store as any).owner,
  append = owner.append.bind(owner);
owner.append = (frame: string, digest: string) => {
  const tx = JSON.parse(
    Buffer.from(JSON.parse(frame).payload_b64, "base64").toString(),
  );
  if (
    tx.mutations.some(
      (m: any) =>
        m.object_type === "ApiCommand" && m.object_id === body.request_id,
    )
  ) {
    if (phase === "after") append(frame, digest);
    process.kill(process.pid, "SIGKILL");
  }
  return append(frame, digest);
};
command(route, body, binding);
throw Error("crash point not hit");
