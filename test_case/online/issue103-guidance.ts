/** Isolated, bounded real-provider acceptance. Never starts the interactive service. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { getModel } from "@earendil-works/pi-ai/compat";
import { App } from "../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../src/pi_secretary/src/api-v1.ts";
import { fixtureModel, roleModel } from "../../src/pi_secretary/src/model.ts";
import { id, revise, hash } from "../../src/pi_secretary/src/store.ts";
import { guidanceFor } from "../../src/pi_secretary/src/guidance.ts";
import type {
  Execution,
  ModelCall,
  TaskResult,
} from "../../src/pi_secretary/src/contracts.ts";
import { boundedTools } from "./tool-budget.ts";

const directory = fs.mkdtempSync(path.resolve(".demo-data/issue103/live-"));
const credential = process.env.SECRETARY_CREDENTIALS_FILE ?? ".env.local";
const stat = fs.lstatSync(credential);
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
const model = getModel("deepseek", "deepseek-flash");
const adapter = roleModel(model, key, "task");
let physical = 0,
  mainCalls = 0,
  eid = "",
  task = "";
let server: Awaited<ReturnType<typeof serveCore>>;
const toolBudget = { used: 0, limit: 20 };
const requests: {
  ordinal: number;
  body_hash: string;
  bytes: number;
  at: string;
  http?: number;
}[] = [];
const app = await App.open(directory, {
  main: {
    model: fixtureModel,
    stream: () => {
      mainCalls++;
      throw Error("MAIN_UNAVAILABLE_FOR_ACCEPTANCE");
    },
  },
  task: {
    model,
    stream: boundedTools(
      (m, context, options) =>
        adapter.stream(m, context, {
          ...options,
          fetch: async (url, init) => {
            assert.equal(
              String(url),
              "https://api.deepseek.com/chat/completions",
              "DESTINATION_MISMATCH",
            );
            assert(++physical <= 6, "PHYSICAL_CALL_LIMIT");
            assert(
              typeof init?.body === "string" &&
                Buffer.byteLength(init.body) <= 180000,
              "REQUEST_LIMIT",
            );
            const entry = {
              ordinal: physical,
              body_hash: hash(init.body),
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
            // The first real request is already sent. Its frozen body cannot contain this instruction.
            if (physical === 1)
              server.service.command(
                server.service.principal,
                `executions/${eid}/guidance`,
                {
                  request_id: id(),
                  task_id: task,
                  text: "Master refinement: use only first.txt. Do not read second.txt and do not create or modify any file. Include the exact marker GUIDANCE_LIVE_103 in the final summary. Explicitly process this guidance using guidance_receipt before successful completion. The original acceptance still requires a factual report from the permitted source subset.",
                },
              );
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
server = await serveCore(app, 0, undefined, { pump: false });
try {
  app.store.commit([
    revise(app.host.session, {
      state: "RECOVERY_BLOCKED",
      recovery_error: "isolated-live-main-unavailable",
    }),
  ]);
  const p = app.scheduler.propose(
    "Read first.txt, then second.txt, and report the evidence. Master may refine the permitted source subset during execution. Use read tools, do not use bash or write, and finish with submit_result after reporting the permitted evidence.",
    id(),
    app.host.sessionID,
    {
      acceptance: [
        "Provide a factual summary from the source subset permitted by the latest Master instruction.",
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
  eid = e.id;
  task = e.task_id;
  const root = app.scheduler.rootFor(e);
  fs.writeFileSync(
    path.join(root, "first.txt"),
    "Permitted evidence: the orchard has seven apple trees.\n",
  );
  fs.writeFileSync(
    path.join(root, "second.txt"),
    "Excluded evidence: the warehouse has eleven crates.\n",
  );
  fs.writeFileSync(path.join(root, "gate"), "ready");
  app.scheduler.ready(eid);
  await app.scheduler.run(eid);
  const final = app.store.get<Execution>("Execution", eid);
  const result = final.result_id
    ? app.store.get<TaskResult>("TaskResult", final.result_id)
    : null;
  const guidance = guidanceFor(app.store).list(eid);
  const calls = app.store.indexed<ModelCall>(
    "ModelCall",
    "scope.execution_id",
    [eid],
  );
  const observations = app.store.logs
    .filter(
      (l) =>
        l.scope.execution_id === eid && l.event_type === "executor.tool.result",
    )
    .map((l) => app.store.read<any>(l.payload));
  const report = {
    provider: model.provider,
    model: model.id,
    physical,
    tools: toolBudget.used,
    mainCalls,
    mainState: app.host.session.state,
    state: final.state,
    result,
    guidance: guidance.map((g) => guidanceFor(app.store).view(g)),
    requests,
    calls: calls.map((c) => ({
      id: c.id,
      state: c.state,
      cutoff: c.guidance_cutoff,
      request: c.request.sha256,
      response: c.response ? app.store.read(c.response) : null,
    })),
    toolResults: observations,
  };
  fs.writeFileSync(
    path.join(directory, "evidence.json"),
    JSON.stringify(report, null, 2),
  );
  assert.equal(final.state, "SUCCEEDED");
  assert.equal(mainCalls, 0);
  assert.equal(app.host.session.state, "RECOVERY_BLOCKED");
  assert.equal(guidance.length, 1);
  assert(guidance[0].received_at && guidance[0].guided_at);
  assert.equal(guidance[0].disposition, "ADOPTED");
  assert(result?.summary.includes("GUIDANCE_LIVE_103"));
  assert(physical >= 2 && physical <= 6);
  assert.equal(guidanceFor(app.store).coverage(eid, calls[0].id).size, 0);
  assert(
    calls
      .slice(1)
      .some((c) =>
        guidanceFor(app.store).coverage(eid, c.id).has(guidance[0].id),
      ),
  );
  assert.equal(
    fs.readFileSync(path.join(root, "first.txt"), "utf8"),
    "Permitted evidence: the orchard has seven apple trees.\n",
  );
  assert.equal(
    fs.readFileSync(path.join(root, "second.txt"), "utf8"),
    "Excluded evidence: the warehouse has eleven crates.\n",
  );
  // Successful tool results retain the read path in their stable event key.
  const reads = observations.filter(
    (x) =>
      x.key?.includes(":read:") &&
      !JSON.stringify(x.result).includes("GUIDANCE_PENDING"),
  );
  assert(reads.length > 0);
  assert(
    !JSON.stringify(reads).includes("eleven crates"),
    "EXCLUDED_SOURCE_READ",
  );
  console.log(
    JSON.stringify({
      status: "PASS",
      directory,
      physical,
      tools: toolBudget.used,
      state: final.state,
      mainCalls,
    }),
  );
} finally {
  await server.close();
}
