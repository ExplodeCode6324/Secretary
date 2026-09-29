// One bounded synthetic main-session request, isolated Store, fixture task executor.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../src/pi_secretary/src/app.ts";
import {
  modelConfig,
  fixtureModel,
  fixtureStream,
} from "../../src/pi_secretary/src/model.ts";
import { serve, conversation } from "../../src/pi_secretary/src/backend.ts";
import { api } from "../../src/pi_secretary/src/ui-client.ts";
const report = process.argv[2];
if (!report) throw Error("report path required");
const keys = JSON.parse(
  fs.readFileSync(
    process.env.SECRETARY_CREDENTIALS_FILE ??
      ".demo-data/live-credentials.json",
    "utf8",
  ),
);
process.env.SECRETARY_MODE = "live";
process.env.SECRETARY_MAIN_PROVIDER ??= "opencode-go";
process.env.SECRETARY_MAIN_MODEL ??= "deepseek-v4.1-flash";
process.env.SECRETARY_MAIN_API_KEY = keys.main;
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "secretary-stream-live-"),
);
const app = await App.open(directory, {
  main: modelConfig("main"),
  task: { model: fixtureModel, stream: fixtureStream },
});
const server = await serve(app);
const controller = new AbortController();
const started = Date.now();
const samples: {
  at_ms: number;
  status: string;
  text_chars: number;
  thinking_chars: number;
}[] = [];
try {
  const client = (await api(server.endpoint, "/api/client", {})).client;
  const response = await fetch(
    server.endpoint.url + `/api/stream?client=${client}&thinking=1`,
    {
      headers: { Authorization: `Bearer ${server.endpoint.token}` },
      signal: controller.signal,
    },
  );
  const reader = response
    .body!.pipeThrough(new TextDecoderStream())
    .getReader();
  const consuming = (async () => {
    let buffer = "";
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        buffer += part.value;
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          for (const p of JSON.parse(line.slice(6)).previews)
            samples.push({
              at_ms: Date.now() - started,
              status: p.status,
              text_chars: p.blocks
                .filter((b: any) => b.type === "text")
                .reduce((n: number, b: any) => n + b.text.length, 0),
              thinking_chars: p.blocks
                .filter((b: any) => b.type === "thinking")
                .reduce((n: number, b: any) => n + b.text.length, 0),
            });
        }
      }
    } catch {
    } finally {
      reader.releaseLock();
    }
  })();
  await api(server.endpoint, "/api/message", {
    client,
    request_id: crypto.randomUUID(),
    text: "这是独立的显示验收。不要调用工具、创建任务或修改记忆。请用中文写三句简短说明，分别解释流式显示、完成后显示、显示偏好。",
  });
  await app.host.drain();
  await new Promise((r) => setTimeout(r, 150));
  controller.abort();
  await consuming;
  const messages = conversation(app, true).filter(
    (m) => m.role === "secretary",
  );
  const result = {
    model: app.host.model.id,
    elapsed_ms: Date.now() - started,
    samples,
    final_messages: messages.length,
    final_text_chars: messages.reduce((n, m) => n + m.text.length, 0),
    final_thinking_chars: messages.reduce(
      (n, m) => n + (m.thinking?.length ?? 0),
      0,
    ),
    incomplete: messages.some((m) => m.incomplete),
    task_count: app.store.all("TaskPlan").length,
    operation_count: app.store.all("Operation").length,
    text_stream_seen: samples.some(
      (s) => s.status === "running" && s.text_chars > 0,
    ),
    thinking_stream_seen: samples.some(
      (s) => s.status === "running" && s.thinking_chars > 0,
    ),
  };
  fs.writeFileSync(report, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (
    result.incomplete ||
    !result.final_text_chars ||
    result.task_count ||
    result.operation_count
  )
    process.exitCode = 1;
} finally {
  controller.abort();
  await server.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
