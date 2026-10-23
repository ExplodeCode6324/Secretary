import fs from "node:fs";
import sharp from "sharp";
import path from "node:path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { App } from "../../../../src/pi_secretary/src/app.ts";
import { ApplicationService } from "../../../../src/pi_secretary/src/application-service.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../../src/pi_secretary/src/model.ts";
import { id, hash } from "../../../../src/pi_secretary/src/store.ts";
import type {
  Input,
  AttachmentImport,
} from "../../../../src/pi_secretary/src/contracts.ts";
const [dir, phase, info, diagnostic] = process.argv.slice(2),
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
const emptyFailure: StreamFn = async (model) => {
  const response = await replyStream([], model).result();
  response.stopReason = "error";
  response.errorMessage = "Synthetic rejection";
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "error", reason: "error", error: response });
  stream.end(response);
  return stream;
};
const app = await App.open(dir, {
    model,
    stream: diagnostic ? emptyFailure : fixtureStream,
  }),
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
const input = app.host.accept("withdrawn synthetic text", id(), "MASTER", [
  app.store.get<AttachmentImport>("AttachmentImport", request).attachment_id,
]);
if (!diagnostic) model.input = ["text"];
await app.host.drain();
if (diagnostic) {
  app.host.accept("queued after repeated empty diagnostic");
  await app.host.resume();
}
if (app.host.session.state !== "RECOVERY_BLOCKED")
  throw Error("fixture did not block");
const body = {
    request_id: id(),
    expected_revision: String(app.store.get<Input>("Input", input.id).revision),
  },
  route = `inputs/${input.id}/withdraw`;
const diagnosticEvents = app.store
  .events("main.message")
  .filter((e) => app.store.read<any>(e.payload).role === "assistant")
  .map((e) => e.event_id);
const calls = app.store
  .all<import("../../../../src/pi_secretary/src/contracts.ts").ModelCall>(
    "ModelCall",
  )
  .map((c) => ({
    id: c.id,
    revision: c.revision,
    state: c.state,
    response: c.response,
  }));
if (diagnostic && diagnosticEvents.length < 2)
  throw Error(
    "repeated diagnostic fixture missing: " +
      JSON.stringify({
        state: app.host.session.state,
        error: app.host.session.recovery_error,
        diagnostics: diagnosticEvents.length,
        calls: calls.length,
      }),
  );
fs.writeFileSync(
  info,
  JSON.stringify({ body, route, inputID: input.id, diagnosticEvents, calls }),
);
const commit = app.store.commit.bind(app.store);
app.store.commit = ((records, ...rest) => {
  const target = records.some(
    (r) => r.record_type === "Input" && r.state === "WITHDRAWN",
  );
  if (target && phase === "before") process.kill(process.pid, "SIGKILL");
  const value = commit(records, ...rest);
  if (target && phase === "after") process.kill(process.pid, "SIGKILL");
  return value;
}) as typeof app.store.commit;
service.command(service.principal, route, body);
throw Error("expected crash not reached");
