import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const out = process.argv[2];
if (!out) throw new Error("output directory required");
const binary = resolve("src-tauri/target/release/secretary-desktop-spike");
const cfg = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const cap = JSON.parse(
  readFileSync("src-tauri/capabilities/main.json", "utf8"),
);
assert.deepEqual(cfg.app.security.capabilities, ["main"]);
assert.deepEqual(cap.windows, ["main"]);
assert.deepEqual(
  [...cap.permissions].sort(),
  [
    ...[
      "profiles",
      "transient",
      "connect",
      "draft",
      "submit",
      "query",
      "subscribe",
      "anchor",
      "stop",
      "download",
    ].map((x) => "allow-bridge-" + x),
    "allow-phaseui-view",
    "allow-study-metrics",
    "allow-study-mode",
    "allow-study-ready",
    "core:webview:allow-set-webview-zoom",
  ].sort(),
);
assert.ok(!cfg.app.withGlobalTauri);
assert.ok(cfg.app.security.csp.includes("object-src 'none'"));
const tree = spawnSync(
  "cargo",
  [
    "tree",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--locked",
    "-e",
    "normal",
  ],
  { encoding: "utf8" },
);
assert.equal(tree.status, 0, tree.stderr);
assert.ok(!tree.stdout.includes("tauri-plugin-wdio"));
writeFileSync(out + "/release-dependency-tree.txt", tree.stdout);
const proc = spawn(binary, [], { stdio: ["ignore", "pipe", "pipe"] });
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ready timeout")), 30000);
    proc.stdout.on("data", (data) => {
      if (data.toString().includes("STUDY_READY")) {
        clearTimeout(timer);
        resolve(null);
      }
    });
    proc.on("error", reject);
  });
  const sockets = spawnSync(
    "lsof",
    ["-a", "-p", String(proc.pid), "-iTCP", "-sTCP:LISTEN", "-Fn"],
    { encoding: "utf8" },
  );
  assert.equal(sockets.status, 1, sockets.stdout || sockets.stderr);
  assert.equal(sockets.stdout.trim(), "");
  assert.equal(sockets.stderr.trim(), ""); // lsof returns 1 when no matches
  writeFileSync(
    out + "/security.json",
    JSON.stringify(
      {
        status: "PASS",
        capability: cap,
        csp: cfg.app.security.csp,
        pid: proc.pid,
        listeningTCP: [],
        binary_sha256: createHash("sha256")
          .update(readFileSync(binary))
          .digest("hex"),
        scope:
          "ordinary Release main-process listeners and default-feature dependency tree; not a system-wide port audit",
      },
      null,
      2,
    ),
  );
} finally {
  if (proc.exitCode === null) {
    proc.kill("SIGTERM");
    await new Promise((resolve) => proc.once("exit", resolve));
  }
}
