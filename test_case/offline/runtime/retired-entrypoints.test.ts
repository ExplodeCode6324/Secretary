import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../../src/pi_secretary/src/api-v1.ts";

test("retired Web/TUI launchers and assets are absent; rejected flags cannot start Core or read live credentials", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "secretary-retired-entry-"),
  );
  const env = {
    ...process.env,
    SECRETARY_DATA: directory,
    SECRETARY_MODE: "fixture",
    SECRETARY_CREDENTIALS_FILE: path.join(directory, "must-not-read.json"),
    SECRETARY_RUNTIME_FILE: path.join(directory, "must-not-read-runtime.json"),
  };
  try {
    const scripts = JSON.parse(fs.readFileSync("package.json", "utf8")).scripts;
    assert.equal(scripts["start:web"], undefined);
    assert.equal(scripts["start:web:live"], undefined);
    for (const file of [
      "web.ts",
      "tui.ts",
      "client-tui.ts",
      "ui-client.ts",
      "stop-ui.ts",
      "activity-terminal.ts",
      "legacy-client-unavailable.ts",
    ])
      assert(!fs.existsSync("src/pi_secretary/src/" + file));
    assert(!fs.existsSync("src/pi_secretary/web/index.html"));
    for (const flag of ["--web", "--web=true"]) {
      for (const [file, args, error] of [
        ["src/pi_secretary/scripts/start-live.ts", [flag], "LEGACY_UI_RETIRED"],
        [
          "src/pi_secretary/src/core-cli.ts",
          ["start", flag],
          "Unexpected Core arguments",
        ],
      ] as const) {
        const result = spawnSync(
          process.execPath,
          ["--import", "tsx", file, ...args],
          { env, encoding: "utf8", timeout: 10000 },
        );
        assert.equal(result.status, 1);
        assert(result.stderr.includes(error));
        assert(!result.stderr.includes("ENOENT"));
        assert.deepEqual(fs.readdirSync(directory), []);
      }
    }
    const app = await App.open(directory);
    const server = await serveCore(app, 0, undefined, { pump: false });
    try {
      for (const route of [
        "/",
        "/index.html",
        "/app.js",
        "/style.css",
        "/markdown.js",
        "/activity.js",
        "/timeline-window.js",
        "/api/client",
        "/api/command",
        "/api/poll",
        "/api/state",
        "/api/health",
        "/api/v2/core",
      ]) {
        const response = await fetch(server.endpoint.url + route, {
          headers: { Authorization: `Bearer ${server.endpoint.token}` },
        });
        assert.equal(response.status, 404, route);
        assert(!response.headers.get("content-type")?.includes("text/html"));
      }
    } finally {
      await server.close();
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
