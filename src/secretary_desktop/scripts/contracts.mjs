import fs from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const outputs = new Map([
  [
    "src-tauri/contracts/schema.json",
    fs.readFileSync(root + "docs/api/v1/schema.json", "utf8"),
  ],
  [
    "src-tauri/contracts/operations.json",
    JSON.stringify(
      JSON.parse(
        fs.readFileSync(root + "docs/api/v1/operations.json", "utf8"),
      ).filter(
        (o) => !o.path.includes("/admin/") && !o.path.includes("/push-"),
      ),
      null,
      2,
    ) + "\n",
  ],
  [
    "src/contracts.ts",
    "// Generated from Core API v1. Do not edit.\n" +
      fs.readFileSync(root + "src/pi_secretary/src/api/contracts.ts", "utf8"),
  ],
]);
for (const [path, content] of outputs) {
  const target = new URL("../" + path, import.meta.url);
  if (process.argv.includes("--check")) {
    if (fs.readFileSync(target, "utf8") !== content)
      throw Error("Contract drift: " + path);
  } else {
    fs.mkdirSync(new URL(".", target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}
