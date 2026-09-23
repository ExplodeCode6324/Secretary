import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { api, type Endpoint } from "../src/ui-client.ts";
const until = async (condition: () => boolean) => {
  for (let n = 0; n < 150; n++) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("TIMEOUT");
};
test("two concurrently launched TUI processes attach one backend; closing a client preserves state", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-double-open-"));
  const launch = () => {
    const p = spawn(
      process.execPath,
      ["--import", "tsx", "pi_secretary/src/client-tui.ts"],
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
    return { p, text: () => text, exited: once(p, "exit") };
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
    await a.exited;
    const { client } = await api(endpoint!, "/api/client", {});
    const state = await api(endpoint!, "/api/state?client=" + client);
    assert.equal(
      state.messages.filter((m: { role: string }) => m.role === "master")
        .length,
      2,
    );
    const before = state.session;
    b.p.stdin.write("/quit\n");
    await b.exited;
    assert.equal((await api(endpoint!, "/api/health")).session, before);
  } finally {
    for (const c of [a, b]) if (c.p.exitCode === null) c.p.kill("SIGTERM");
    if (endpoint) {
      await api(endpoint, "/api/shutdown", {}).catch(() => {});
      await until(() => {
        try {
          process.kill(endpoint!.pid, 0);
          return false;
        } catch {
          return true;
        }
      });
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
