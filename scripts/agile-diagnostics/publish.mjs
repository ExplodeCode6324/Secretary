import fs from "node:fs";
import { readJSON, fail } from "./io.mjs";
import path from "node:path";
import { privateJSON } from "./io.mjs";
/** Positive status is the last fsynced publication, never a prerequisite for validation. */
export async function publishCapture(root, manifest, validate) {
  const file = path.join(root, "manifest.json");
  const exists = fs.existsSync(file);
  if (exists) {
    const prior = readJSON(file);
    if (
      prior.capture_id !== manifest.capture_id ||
      !["VALIDATING", "CAPTURED"].includes(prior.status)
    )
      fail("FOREIGN_MANIFEST");
    if (
      JSON.stringify({ ...prior, status: "CAPTURED" }) !==
      JSON.stringify({ ...manifest, status: "CAPTURED" })
    )
      fail("MANIFEST_CHANGED");
    if (prior.status === "CAPTURED") return validate();
  }
  privateJSON(file, { ...manifest, status: "VALIDATING" }, { replace: exists });
  const evidence = await validate();
  privateJSON(file, { ...manifest, status: "CAPTURED" }, { replace: true });
  return evidence;
}
