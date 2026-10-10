import test from "node:test";
import assert from "node:assert/strict";
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
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
export async function fixture(
  run: (
    app: App,
    server: Awaited<ReturnType<typeof serveCore>>,
    c: CoreClient,
    dir: string,
  ) => Promise<void>,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue9-sync-"));
  const app = await App.open(dir, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  const server = await serveCore(app, 0, undefined, { pump: false });
  try {
    await run(app, server, new CoreClient(server.endpoint), dir);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
export async function target(c: CoreClient, name: string) {
  const receipt = await c.command("clients", { request_id: id(), name });
  const client = receipt.resource_ids.find(
    (r) => r.type === "ClientRegistration",
  )!.id;
  await c.command("clients/" + client + "/notification-target", {
    request_id: id(),
    enabled: true,
  });
  const info: any = await c.query("clients/" + client + "/notification-target");
  return {
    id: client,
    client: new CoreClient(c.endpoint, info.binding),
    binding: info.binding,
  };
}
export async function drain(c: CoreClient, cursor: string) {
  const batches: any[] = [];
  let page: string | undefined;
  for (let i = 0; i < 1000; i++) {
    const r = await c.changes(cursor, page);
    batches.push(...r.batches);
    cursor = r.next_cursor;
    page = r.next_page ?? undefined;
    if (!r.has_more) return { batches, cursor };
  }
  throw Error("unbounded catch-up");
}
