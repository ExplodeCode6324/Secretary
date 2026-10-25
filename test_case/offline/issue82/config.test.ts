import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { parseConfig } from "../../../src/pi_secretary/src/tui/config.ts";
const evidence = path.resolve(".demo-data/issue82-tui/implementation");
fs.mkdirSync(evidence, { recursive: true, mode: 0o700 });
test("launcher requires explicit private profile and mode; no environment defaults or Core reads", () => {
  const parent = fs.mkdtempSync(path.join(evidence, "config-test-")),
    data = path.join(parent, "private");
  fs.mkdirSync(data, { mode: 0o700 });
  assert.throws(() => parseConfig([]), /EXPLICIT/);
  assert.throws(() => parseConfig(["--data", "."]), /EXPLICIT/);
  const value = parseConfig(["--data", data, "--mode", "fixture"]);
  assert.equal(value.mode, "fixture");
  assert.deepEqual(fs.readdirSync(data), []);
  assert.throws(
    () => parseConfig(["--data", data, "--mode", "live", "--send", "x"]),
    /USAGE/,
  );
  fs.symlinkSync(data, path.join(parent, "link"));
  assert.throws(
    () =>
      parseConfig(["--data", path.join(parent, "link"), "--mode", "fixture"]),
    /UNSAFE/,
  );
  const config = path.join(parent, "config.json");
  fs.writeFileSync(
    config,
    JSON.stringify({
      data,
      mode: "live",
      aliases: { historyAlias: "history" },
    }),
    { mode: 0o600 },
  );
  assert.equal(
    parseConfig(["--config", config]).aliases.historyAlias,
    "history",
  );
  fs.chmodSync(config, 0o644);
  assert.throws(() => parseConfig(["--config", config]), /UNSAFE_CONFIG/);
  const inside = path.join(data, "config.json");
  fs.writeFileSync(inside, JSON.stringify({ data, mode: "fixture" }), {
    mode: 0o600,
  });
  assert.throws(() => parseConfig(["--config", inside]), /OUTSIDE_CORE_DATA/);
});
