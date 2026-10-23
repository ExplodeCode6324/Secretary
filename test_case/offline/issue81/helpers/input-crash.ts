import fs from "node:fs";
import sharp from "sharp";
import path from "node:path";
import { App } from "../../../../src/pi_secretary/src/app.ts";
import { ApplicationService } from "../../../../src/pi_secretary/src/application-service.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../../src/pi_secretary/src/model.ts";
import { id, hash } from "../../../../src/pi_secretary/src/store.ts";
import type { AttachmentImport } from "../../../../src/pi_secretary/src/contracts.ts";
const [dir, phase, info] = process.argv.slice(2),
  model = {
    ...fixtureModel,
    input: ["text", "image"] as ("text" | "image")[],
    contextWindow: 128000,
  };
process.env.SECRETARY_VISION_BUDGET_PROFILES = JSON.stringify([
  {
    version: 1,
    provider: model.provider,
    api: model.api,
    model: model.id,
    baseUrl: model.baseUrl,
    tokens_per_image: 8192,
    max_side: 4096,
    max_pixels: 4194304,
    source: "Synthetic crash fixture",
  },
]);
const app = await App.open(dir, { model, stream: fixtureStream }),
  service = new ApplicationService(app),
  bytes = await sharp({
    create: { width: 12, height: 12, channels: 3, background: "red" },
  })
    .png()
    .toBuffer(),
  source = path.join(dir, "synthetic.png"),
  request = id();
fs.writeFileSync(source, bytes);
service.command(service.principal, "attachments/import", {
  request_id: request,
  source_path: source,
  expected_sha256: hash(bytes),
  expected_bytes: String(bytes.length),
  name: "synthetic.png",
});
await service.attachmentImports.settle();
fs.unlinkSync(source);
const body = {
  request_id: id(),
  text: "image crash fixture",
  attachment_ids: [
    app.store.get<AttachmentImport>("AttachmentImport", request).attachment_id,
  ],
};
fs.writeFileSync(info, JSON.stringify({ body, sha256: hash(bytes) }));
const commit = app.store.commit.bind(app.store);
app.store.commit = ((records, ...rest) => {
  const target =
    phase === "input"
      ? records.some((r) => r.record_type === "Input" && r.state === "ACCEPTED")
      : phase === "checkpoint"
        ? records.some(
            (r) =>
              r.record_type === "Context" &&
              r.capture_kind === "CHECKPOINT" &&
              r.input_ids.length > 0,
          )
        : records.some(
            (r) => r.record_type === "ModelCall" && r.state === "PREPARED",
          );
  const value = commit(records, ...rest);
  if (target) process.kill(process.pid, "SIGKILL");
  return value;
}) as typeof app.store.commit;
service.command(service.principal, "messages", body);
await app.host.drain();
throw Error("expected crash not reached");
