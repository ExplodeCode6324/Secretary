import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { base, id } from "../../../src/pi_secretary/src/store.ts";
import type {
  Notification,
  PushTarget,
  PushDispatch,
} from "../../../src/pi_secretary/src/contracts.ts";
import type { PushTargetConfig } from "../../../src/pi_secretary/src/api/contracts.ts";
import type { PushDelivery } from "../../../src/pi_secretary/src/push-service.ts";
export const config = (endpoint = "http://127.0.0.1:1"): PushTargetConfig => ({
  name: "synthetic",
  kind: "NTFY",
  endpoint,
  enabled: true,
  quiet_hours: null,
});
export class Fixture {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-issue22-"));
  time = Date.parse("2030-01-01T12:00:00Z");
  app!: App;
  constructor(
    readonly delivery?: PushDelivery,
    readonly stream: StreamFn = fixtureStream,
  ) {}
  async open() {
    this.app = await App.open(
      this.dir,
      { model: fixtureModel, stream: this.stream },
      undefined,
      { clock: () => this.time, pushDelivery: this.delivery },
    );
  }
  async restart() {
    await this.app.close();
    await this.open();
  }
  async close() {
    await this.app?.close();
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
  notify(message: unknown = "synthetic notification") {
    const n: Notification = {
      ...base(),
      schema_version: 1,
      record_type: "Notification",
      state: "QUEUED",
      session_id: this.app.host.sessionID,
      channel: "local-ui",
      message: this.app.store.put(
        message,
        typeof message === "string" ? "text/plain" : "application/json",
      ),
      delivery_key: id(),
      receipt: null,
      requested_at: new Date(this.time).toISOString(),
    };
    this.app.store.commit([n]);
    return n;
  }
  dispatches() {
    return this.app.store.all<PushDispatch>("PushDispatch");
  }
  secret(t: PushTarget, value: unknown) {
    const dir = path.join(this.dir, "push-secrets");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, t.id + ".json");
    fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
    return file;
  }
}
export async function fixture(
  run: (f: Fixture) => Promise<void>,
  delivery?: PushDelivery,
) {
  const f = new Fixture(delivery);
  try {
    await f.open();
    await run(f);
  } finally {
    await f.close();
  }
}
export async function provider(
  run: (
    endpoint: string,
    received: { body: any; auth?: string; url?: string }[],
    respond: (
      fn: (req: http.IncomingMessage, res: http.ServerResponse) => void,
    ) => void,
  ) => Promise<void>,
) {
  const received: { body: any; auth?: string; url?: string }[] = [];
  let handler = (_req: http.IncomingMessage, res: http.ServerResponse) =>
    res.end(JSON.stringify({ event: "message", id: "synthetic", code: 200 }));
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const b of req) chunks.push(b);
    received.push({
      body: JSON.parse(Buffer.concat(chunks).toString()),
      auth: req.headers.authorization,
      url: req.url,
    });
    handler(req, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    await run(
      "http://127.0.0.1:" +
        (server.address() as import("node:net").AddressInfo).port,
      received,
      (fn) => {
        handler = fn as typeof handler;
      },
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
}
