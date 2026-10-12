import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { ApplicationService } from "../../../src/pi_secretary/src/application-service.ts";
import {
  fixtureModel,
  fixtureStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import type {
  Execution,
  AuthorizationRequest,
} from "../../../src/pi_secretary/src/contracts.ts";
export async function fixture(
  run: (a: App, api: ApplicationService, root: string) => Promise<void>,
  stream: StreamFn = fixtureStream,
) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "scopes-test-")),
  );
  const a = await App.open(path.join(root, "data"), {
    model: fixtureModel,
    stream,
  });
  try {
    await run(a, new ApplicationService(a), root);
  } finally {
    await a.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
export function directory(root: string, name = "project") {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
export function executions(a: App) {
  return a.store.all<Execution>("Execution");
}
export function approve(a: App) {
  for (const q of a.store
    .all<AuthorizationRequest>("AuthorizationRequest")
    .filter((q) => q.state === "PENDING"))
    a.authorization.decide({
      schema_version: 1,
      record_type: "ApprovalCommand",
      request_id: id(),
      authorization_id: q.id,
      expected_revision: q.revision,
      display_hash: q.display_hash,
      decision: "APPROVE",
    });
}
