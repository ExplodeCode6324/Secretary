#!/usr/bin/env node
// Rebuild the two static assets from their checked-in vector source.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const generate = (extra) =>
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/pi_secretary/scripts/braille-art.ts",
      "docs/tui/assets/splash-character.svg",
      "--paper",
      "keep",
      "--top",
      "0.8",
      "--floor",
      "0.65",
      "--saturate",
      "1",
      ...extra,
    ],
    { cwd: root, encoding: "utf8" },
  );
const portrait = generate([
  "--cols",
  "48",
  "--black",
  "0.22",
  "--white",
  "0.70",
  "--shade",
  "0.1",
  "--colors",
  "12",
  "--name",
  "SPLASH_PORTRAIT",
]);
const halo = generate([
  "--cols",
  "30",
  "--crop",
  "65,8,260,74",
  "--black",
  "0.15",
  "--white",
  "0.62",
  "--shade",
  "0",
  "--colors",
  "4",
  "--name",
  "SPLASH_HALO",
]);
const target = path.join(root, "src/pi_secretary/src/tui/splash-art.ts");
if (process.argv.includes("--check")) {
  if (fs.readFileSync(target, "utf8") !== portrait + halo)
    throw Error("SPLASH_ASSETS_OUT_OF_DATE");
} else fs.writeFileSync(target, portrait + halo);
