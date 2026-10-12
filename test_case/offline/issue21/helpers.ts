import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";

export async function scenario(
  dsn: string | undefined,
  run: (app: App, reopen: () => Promise<App>) => Promise<void>,
  stream: StreamFn = fixtureStream,
  model = fixtureModel,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-memory-test-"));
  let app = await App.open(dir, { model, stream }, dsn);
  try {
    await run(app, async () => {
      await app.close();
      app = await App.open(dir, { model, stream }, dsn);
      return app;
    });
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
