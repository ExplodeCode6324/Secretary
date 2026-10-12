import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../../src/pi_secretary/src/api-v1.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";

test("CRASH: actual SIGKILL after journal admission and before SSE write recovers complete transaction from applied cursor", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-issue9-kill-"));
  const child = fork(new URL("./workers/crash.ts", import.meta.url), [dir], {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let stderr = "";
  child.stderr!.on("data", (chunk) => (stderr += chunk));
  const timeout = setTimeout(() => child.kill("SIGKILL"), 15000);
  let server: Awaited<ReturnType<typeof serveCore>> | undefined;
  try {
    const [ready] = await once(child, "message");
    assert.equal(ready.phase, "ready");
    const controller = new AbortController();
    const response = await fetch(
      ready.endpoint.url + "/api/v1/sync/stream?after=" + ready.cursor,
      {
        headers: { Authorization: `Bearer ${ready.endpoint.token}` },
        signal: controller.signal,
      },
    );
    const reader = response.body!.getReader();
    const first = await reader.read();
    assert(new TextDecoder().decode(first.value).includes("event: transient"));
    const pending = reader.read().catch(() => null);
    child.send("commit");
    const [committed] = await once(child, "message");
    assert.equal(committed.phase, "committed");
    child.kill("SIGKILL");
    const [, signal] = await once(child, "exit");
    assert.equal(signal, "SIGKILL");
    const remainder = await pending.catch(() => null);
    assert(
      !remainder?.value ||
        !new TextDecoder().decode(remainder.value).includes(committed.cursor),
    );
    controller.abort();
    const app = await App.open(dir, {
      model: fixtureModel,
      stream: fixtureStream,
    });
    server = await serveCore(app, 0, undefined, { pump: false });
    const page = server.service.changes.changes(ready.cursor);
    const recovered = page.transactions.find(
      (tx) => tx.cursor === committed.cursor,
    );
    assert(recovered);
    assert(recovered.changes.some((c) => c.resource_type === "timeline"));
    assert.equal(app.store.all("Input").length, 1);
    assert(server.service.receipt(committed.request));
  } finally {
    clearTimeout(timeout);
    child.kill("SIGKILL");
    await server?.close();
    fs.rmSync(dir, { recursive: true, force: true });
    if (stderr) console.log(stderr);
  }
});
