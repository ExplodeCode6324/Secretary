import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { processHasExited } from "./helpers/process-lifecycle.ts";
import { api, type Endpoint } from "../../../src/pi_secretary/src/ui-client.ts";
const until = async (condition: () => boolean) => {
  for (let n = 0; n < 150; n++) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("TIMEOUT");
};
// API v1 retires this legacy UI contract; replacement coverage: offline/issue8 and docs/api/v1/verification.md.
test.skip("two concurrently launched TUI processes attach one backend; closing a client preserves state", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-double-open-"));
  const launch = () => {
    const p = spawn(
      process.execPath,
      ["--import", "tsx", "src/pi_secretary/src/client-tui.ts"],
      {
        env: { ...process.env, SECRETARY_MODE: "fixture", SECRETARY_DATA: dir },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let text = "";
    p.stdout.on("data", (b) => {
      text += b;
    });
    p.stderr.on("data", (b) => {
      text += b;
    });
    return { p, text: () => text, closed: once(p, "close") };
  };
  const a = launch(),
    b = launch();
  let endpoint: Endpoint | undefined;
  try {
    await until(() => fs.existsSync(path.join(dir, "ui-endpoint.json")));
    endpoint = JSON.parse(
      fs.readFileSync(path.join(dir, "ui-endpoint.json"), "utf8"),
    );
    await until(
      () => a.text().includes("Master ›") && b.text().includes("Master ›"),
    );
    a.p.stdin.write("TUI_A_unique\n");
    b.p.stdin.write("TUI_B_unique\n");
    await until(
      () =>
        a.text().includes("TUI_B_unique") && b.text().includes("TUI_A_unique"),
    );
    a.p.stdin.write("/quit\n");
    await a.closed;
    const { client } = await api(endpoint!, "/api/client", {});
    const state = await api(endpoint!, "/api/state?client=" + client);
    assert.equal(
      state.messages.filter((m: { role: string }) => m.role === "master")
        .length,
      2,
    );
    const before = state.session;
    b.p.stdin.write("/quit\n");
    await b.closed;
    assert.equal((await api(endpoint!, "/api/health")).session, before);
  } finally {
    for (const c of [a, b])
      if (c.p.exitCode === null && c.p.signalCode === null) c.p.kill("SIGTERM");
    await Promise.all([a.closed, b.closed]);
    if (endpoint) {
      await api(endpoint, "/api/shutdown", {}).catch(() => {});
      await until(() => processHasExited(endpoint!.pid));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
