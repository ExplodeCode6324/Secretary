/** Actual provider image request; capture is synthetic, not native clipboard acceptance. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import sharp from "sharp";
import { randomInt } from "node:crypto";
import { attachCore } from "../../src/pi_secretary/src/core-client.ts";
import { LocalFiles } from "../../src/pi_secretary/src/tui/state.ts";
import { Delivery } from "../../src/pi_secretary/src/tui/delivery.ts";
import {
  ImageImports,
  requireImageCapability,
} from "../../src/pi_secretary/src/tui/image-import.ts";
import { hash } from "../../src/pi_secretary/src/store.ts";
process.env.SECRETARY_MODE = "live";
const root = path.resolve(process.argv[2]);
assert(root.startsWith(path.resolve(".demo-data/issue94") + path.sep));
const client = await attachCore(path.join(root, "core")),
  core = await client!.core();
const files = new LocalFiles(path.join(root, "image-client"));
const state = await files.open(core.data_domain_id, core.mode),
  delivery = new Delivery(state, files);
await delivery.connect(client!);
const code = "V" + randomInt(10000, 99999);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="white"/><circle cx="110" cy="150" r="65" fill="#00a050"/><text x="230" y="165" font-size="55" font-family="Helvetica" fill="black">${code}</text></svg>`;
const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
fs.writeFileSync(path.join(root, "vision-fixture.png"), bytes, { mode: 0o600 });
try {
  delivery.edit(
    "Main",
    "Describe the shape and its color in this image and transcribe the exact visible code. Do not create or modify any task.",
  );
  const imports = new ImageImports(delivery, files),
    attempt = await imports.begin();
  await imports.captured(attempt, bytes, await requireImageCapability(client!));
  const deadline = Date.now() + 20000;
  while (attempt.status !== "READY") {
    if (Date.now() > deadline || attempt.status === "FAILED")
      throw Error("IMPORT_NOT_READY:" + attempt.error);
    await new Promise((r) => setTimeout(r, 100));
    await imports.reconcile();
  }
  const attachmentID = attempt.attachment_id!;
  await delivery.submit(state.drafts.Main.raw, state.drafts.Main.raw);
  await delivery.reconcile();
  assert(!state.pending, "SEND_NOT_CONFIRMED");
  const output = {
    evidence: "REAL_PROVIDER_WITH_SYNTHETIC_CAPTURE_NOT_NATIVE_CLIPBOARD",
    at: new Date().toISOString(),
    code,
    shape: "circle",
    color: "green",
    sha256: hash(bytes),
    attachment_id: attachmentID,
    import_request_id: attempt.body!.request_id,
  };
  fs.writeFileSync(
    path.join(root, "image-expectation.json"),
    JSON.stringify(output, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(output));
} finally {
  await delivery.close();
  await files.close();
}
