import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../../src/pi_secretary/src/api-v1.ts";
import { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import {
  fixtureModel,
  fixtureStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import type { Input } from "../../../src/pi_secretary/src/contracts.ts";
export async function fixture(
  run: (f: Fixture) => Promise<void>,
  stream = fixtureStream,
  dsn?: string,
) {
  const f = new Fixture(stream, dsn);
  try {
    await f.open();
    await run(f);
  } finally {
    await f.close();
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
}
export class Fixture {
  readonly dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-issue23-"));
  time = Date.now();
  app!: App;
  server!: Awaited<ReturnType<typeof serveCore>>;
  client!: CoreClient;
  constructor(
    readonly stream: StreamFn = fixtureStream,
    readonly dsn?: string,
  ) {}
  async open() {
    this.app = await App.open(
      this.dir,
      { model: fixtureModel, stream: this.stream },
      this.dsn,
      { clock: () => this.time },
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
  source() {
    const input = this.app.host.accept("synthetic timer request");
    return this.app.store.logs
      .filter(
        (e) =>
          e.event_type === "input.accepted" &&
          this.app.store.read<Input>(e.payload).id === input.id,
      )
      .map((e) => e.event_id);
  }
  args(delta = 1000) {
    return {
      at: new Date(this.time + delta).toISOString(),
      note: "Synthetic reminder 中文 😀",
    };
  }
}
