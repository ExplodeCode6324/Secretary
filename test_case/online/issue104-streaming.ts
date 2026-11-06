/** Bounded real DeepSeek acceptance through Store, HTTP and SSE. No production data. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { getModel } from "@earendil-works/pi-ai/compat";
import { App } from "../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../src/pi_secretary/src/api-v1.ts";
import { CoreClient } from "../../src/pi_secretary/src/core-client.ts";
import { RemoteViews } from "../../src/pi_secretary/src/tui/remote.ts";
import { fixtureModel, roleModel } from "../../src/pi_secretary/src/model.ts";
import { id, hash, revise } from "../../src/pi_secretary/src/store.ts";
import type {
  Execution,
  ModelCall,
  Input,
  Feedback,
} from "../../src/pi_secretary/src/contracts.ts";
import type {
  TaskBrowserMessages,
  Message,
} from "../../src/pi_secretary/src/api/contracts.ts";
import { boundedTools } from "./tool-budget.ts";

const directory = fs.mkdtempSync(path.resolve(".demo-data/issue104/live-"));
const credential = process.env.SECRETARY_CREDENTIALS_FILE ?? ".env.local",
  stat = fs.lstatSync(credential);
assert(
  stat.isFile() &&
    !stat.isSymbolicLink() &&
    !(stat.mode & 0o077) &&
    stat.uid === process.getuid?.(),
  "UNSAFE_CREDENTIAL_FILE",
);
const key: unknown = credential.endsWith(".json")
  ? JSON.parse(fs.readFileSync(credential, "utf8")).task
  : parseEnv(fs.readFileSync(credential, "utf8")).DEEPSEEK_API_KEY;
assert(typeof key === "string" && key.trim(), "TASK_KEY_REQUIRED");
const model = getModel("deepseek", "deepseek-flash"),
  adapter = roleModel(model, key, "task");
let physical = 0,
  mainCalls = 0;
const requests: {
    ordinal: number;
    hash: string;
    bytes: number;
    at: string;
    http?: number;
  }[] = [],
  toolBudget = { used: 0, limit: 6 };
const app = await App.open(directory, {
  main: {
    model: fixtureModel,
    stream: () => {
      mainCalls++;
      throw Error("MAIN_DISABLED_FOR_ACCEPTANCE");
    },
  },
  task: {
    model,
    stream: boundedTools(
      (m, c, o) =>
        adapter.stream(m, c, {
          ...o,
          fetch: async (url, init) => {
            assert.equal(
              String(url),
              "https://api.deepseek.com/chat/completions",
            );
            assert(++physical <= 3, "PHYSICAL_CALL_LIMIT");
            assert(
              typeof init?.body === "string" &&
                Buffer.byteLength(init.body) <= 180000,
              "REQUEST_LIMIT",
            );
            const entry = {
              ordinal: physical,
              hash: hash(init.body),
              bytes: Buffer.byteLength(init.body),
              at: new Date().toISOString(),
              http: undefined as number | undefined,
            };
            requests.push(entry);
            fs.writeFileSync(
              path.join(directory, "requests.json"),
              JSON.stringify(requests, null, 2),
            );
            const response = await fetch(url, {
              ...init,
              redirect: "error",
              signal: AbortSignal.any([
                ...(init.signal ? [init.signal] : []),
                AbortSignal.timeout(120000),
              ]),
            });
            entry.http = response.status;
            fs.writeFileSync(
              path.join(directory, "requests.json"),
              JSON.stringify(requests, null, 2),
            );
            return response;
          },
        }),
      toolBudget,
    ),
  },
});
const server = await serveCore(app, 0, undefined, { pump: false }),
  client = new CoreClient(server.endpoint),
  views = new RemoteViews(client);
const samples: {
  at: string;
  call: string;
  state: string;
  id: string;
  revision: string;
  length: number;
  hash: string;
  mainInputs: number;
}[] = [];
try {
  app.store.commit([
    revise(app.host.session, {
      state: "RECOVERY_BLOCKED",
      recovery_error: "isolated-live-main-disabled",
    }),
  ]);
  const p = app.scheduler.propose(
    "This is a streaming display acceptance task; keep internal analysis brief and reserve tokens for the required text and result. Before using any tool, write a normal visible assistant response starting with STREAM_104_BEGIN, followed by 12 numbered sentences explaining safe read-only software testing. Each sentence should have 12 to 16 words. End that visible text with STREAM_104_END. Then call submit_result with success and a short summary containing STREAM_104_END. Do not read, write, run commands or request a decision; the required artifact is your visible text.",
    id(),
    app.host.sessionID,
    {
      acceptance: [
        "Emit the requested visible text with both markers, then submit the result.",
      ],
      preconditions: [
        {
          condition_id: id(),
          kind: "RESOURCE_PRESENT",
          target: "gate",
          required_revision: null,
        },
      ],
    },
  );
  app.scheduler.tick();
  await app.scheduler.idle();
  const e = app.store
    .all<Execution>("Execution")
    .find((x) => x.task_id === p.id)!;
  await views.start();
  await views.taskBrowser.open(p.id);
  await views.taskBrowser.follow(e.id);
  const route = `task-browser/${p.id}/executions/${e.id}/messages`;
  fs.writeFileSync(path.join(app.scheduler.rootFor(e), "gate"), "ready");
  app.scheduler.ready(e.id);
  let done = false;
  const job = app.scheduler.run(e.id).finally(() => {
    done = true;
  });
  const deadline = Date.now() + 160000;
  while (!done && Date.now() < deadline) {
    const page = await client.query<TaskBrowserMessages>(
      route + "?position=latest",
    );
    for (const m of page.items)
      if (
        m.persistence === "transient" &&
        m.model_call_id &&
        m.text.includes("STREAM_104_BEGIN")
      ) {
        const call = app.store.get<ModelCall>("ModelCall", m.model_call_id);
        samples.push({
          at: new Date().toISOString(),
          call: call.id,
          state: call.state,
          id: m.id,
          revision: m.revision,
          length: m.text.length,
          hash: hash(m.text),
          mainInputs: app.store
            .all<Input>("Input")
            .filter((i) => i.producer === "SCHEDULER").length,
        });
      }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!done) app.scheduler.cancel(e.id);
  await job;
  const final = app.store.get<Execution>("Execution", e.id),
    calls = app.store.indexed<ModelCall>("ModelCall", "scope.execution_id", [
      e.id,
    ]);
  const page = await client.query<TaskBrowserMessages>(
    route + "?position=latest",
  );
  const messages = await Promise.all(
    page.items
      .filter((m) => m.model_call_id)
      .map((m) =>
        client.query<Message>(
          route + "/" + encodeURIComponent(m.id) + "/content?position=latest",
        ),
      ),
  );
  const text = messages.map((m) => m.text).join("\n");
  const report = {
    directory,
    provider: model.provider,
    model: model.id,
    physical,
    mainCalls,
    tools: toolBudget.used,
    state: final.state,
    samples,
    requests,
    calls: calls.map((c) => ({
      id: c.id,
      state: c.state,
      request_hash: c.request.sha256,
      response_hash: c.response?.sha256,
      completed_at: c.completed_at,
    })),
    messages: messages.map((m) => ({
      id: m.id,
      revision: m.revision,
      persistence: m.persistence,
      length: m.text.length,
      hash: hash(m.text),
      begin: m.text.includes("STREAM_104_BEGIN"),
      end: m.text.includes("STREAM_104_END"),
    })),
    feedback: app.store
      .all<Feedback>("Feedback")
      .map((f) => ({ kind: f.kind, state: f.state })),
    sse_visible:
      views.taskBrowser.groups
        .get(e.id)
        ?.items.some((m) => m.text.includes("STREAM_104_BEGIN")) ?? false,
  };
  fs.writeFileSync(
    path.join(directory, "evidence.json"),
    JSON.stringify(report, null, 2),
  );
  assert.equal(final.state, "SUCCEEDED");
  assert.equal(mainCalls, 0);
  assert(samples.some((s) => s.state === "IN_FLIGHT" && s.length > 100));
  assert(samples.every((s) => s.mainInputs === 0));
  assert(text.includes("STREAM_104_BEGIN") && text.includes("STREAM_104_END"));
  assert.equal(new Set(messages.map((m) => m.id)).size, messages.length);
  assert(report.sse_visible);
  assert(!report.feedback.some((f) => f.kind === "PROGRESS"));
  for (const sample of samples) {
    const c = calls.find((c) => c.id === sample.call)!;
    assert(sample.at < c.completed_at!);
    assert(
      messages.some((m) => m.id === sample.id && m.persistence === "durable"),
    );
  }
  console.log(
    JSON.stringify({
      status: "PASS",
      directory,
      physical,
      mainCalls,
      samples: samples.length,
      first_preview: samples[0]?.at,
      last_saved: calls.at(-1)?.completed_at,
      state: final.state,
    }),
  );
} finally {
  views.stop();
  await server.close();
}
