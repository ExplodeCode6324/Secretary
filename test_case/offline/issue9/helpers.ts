import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../../src/pi_secretary/src/api-v1.ts";
import { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import { base, id, now } from "../../../src/pi_secretary/src/store.ts";
import type { Notification } from "../../../src/pi_secretary/src/contracts.ts";
export async function fixture(
  run: (f: Fixture) => Promise<void>,
  dsn?: string,
) {
  const f = new Fixture(dsn);
  await f.open();
  try {
    await run(f);
  } finally {
    await f.close();
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
}
export class Fixture {
  readonly dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-issue9-"));
  app!: App;
  server!: Awaited<ReturnType<typeof serveCore>>;
  client!: CoreClient;
  constructor(readonly dsn?: string) {}
  async open() {
    this.app = await App.open(
      this.dir,
      { model: fixtureModel, stream: fixtureStream },
      this.dsn,
    );
    this.server = await serveCore(this.app, 0, undefined, { pump: false });
    this.client = new CoreClient(this.server.endpoint);
  }
  async close() {
    await this.server?.close();
  }
  async restart() {
    await this.close();
    await this.open();
  }
  cursor() {
    return this.server.service.changes.current().cursor;
  }
  notice(text = "Synthetic notification 😀", media = "text/plain") {
    const n: Notification = {
      ...base(),
      schema_version: 1,
      record_type: "Notification",
      session_id: this.app.host.sessionID,
      channel: "local-ui",
      state: "QUEUED",
      message: this.app.store.put(text, media),
      delivery_key: id(),
      receipt: null,
      requested_at: now(),
    };
    this.app.store.commit([n]);
    return n;
  }
  async register(name = "Synthetic client") {
    const r = await this.client.command("clients", { request_id: id(), name });
    return r.resource_ids.find((r) => r.type === "ClientRegistration")!.id;
  }
  raw(route: string, headers: Record<string, string> = {}) {
    return fetch(this.server.endpoint.url + "/api/v1/" + route, {
      headers: {
        Authorization: `Bearer ${this.server.endpoint.token}`,
        ...headers,
      },
    });
  }
}
export async function until(check: () => boolean, milliseconds = 3000) {
  const end = Date.now() + milliseconds;
  while (!check()) {
    if (Date.now() > end) throw Error("CONDITION_TIMEOUT");
    await new Promise((r) => setTimeout(r, 20));
  }
}
