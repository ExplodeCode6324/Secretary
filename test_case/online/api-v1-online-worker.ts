// Bounded API-v1 online scenarios. Keys enter only worker-local roleModel closures.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fork, execFileSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import {
  contentText,
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
} from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai/compat";
import { App } from "../../src/pi_secretary/src/app.ts";
import {
  serveCore,
  type CoreEndpoint,
} from "../../src/pi_secretary/src/api-v1.ts";
import { CoreClient } from "../../src/pi_secretary/src/core-client.ts";
import { roleModel, type StreamFn } from "../../src/pi_secretary/src/model.ts";
import type {
  Context,
  Execution,
  TaskProposal,
} from "../../src/pi_secretary/src/contracts.ts";

type Scenario = "task-chain" | "memory-restart";
const LIMITS = {
  attempts: 12,
  total_ms: 600000,
  request_ms: 90000,
  output_tokens: 4096,
  context_bytes: 80000,
  reserved_recall_attempts: 2,
};
const SOURCE =
  "Synthetic project CedarHarbor-Q7 has code AZURE-314 and deadline 2032-06-17. This is fictional test data. Remember these exact facts and acknowledge briefly. Do not create tasks, make future promises, use tools, or perform external actions.";
const PROBE =
  "Recall the fictional project from our earlier conversation. Return only JSON with fields project, code, deadline, explanation. Follow the currently active language setting for explanation. Do not use tools or perform actions.";
function oracle(text: string) {
  const parsed = JSON.parse(
    text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, ""),
  );
  assert.equal(parsed.project, "CedarHarbor-Q7");
  assert.equal(parsed.code, "AZURE-314");
  assert.equal(parsed.deadline, "2032-06-17");
  assert.equal(typeof parsed.explanation, "string");
  assert(!/\p{Script=Han}/u.test(parsed.explanation));
  assert((parsed.explanation.match(/[A-Za-z]+/g) ?? []).length >= 5);
}
function ceiling(scenario: Scenario, phase: string) {
  return scenario === "memory-restart" && phase !== "recall"
    ? LIMITS.attempts - LIMITS.reserved_recall_attempts
    : LIMITS.attempts;
}
function restartOracle(before: any, after: any) {
  assert.notEqual(after.pid, before.pid);
  assert.notEqual(after.instance_id, before.instance_id);
  assert.equal(after.session_id, before.session_id);
  assert.equal(after.data_domain_id, before.data_domain_id);
  assert.equal(before.exit_code, 0);
  assert.equal(before.old_pid_alive, false);
}
export function scenarioSelfCheck() {
  const good = {
    project: "CedarHarbor-Q7",
    code: "AZURE-314",
    deadline: "2032-06-17",
    explanation: "The synthetic project retains the same exact recorded facts.",
  };
  oracle(JSON.stringify(good));
  for (const field of Object.keys(good))
    assert.throws(() => oracle(JSON.stringify({ ...good, [field]: "wrong" })));
  assert.equal(ceiling("memory-restart", "prepare"), 10);
  assert.equal(ceiling("memory-restart", "recall"), 12);
  assert.equal(ceiling("task-chain", "prepare"), 12);
  const before = {
      pid: 1,
      instance_id: "a",
      session_id: "s",
      data_domain_id: "d",
      exit_code: 0,
      old_pid_alive: false,
    },
    after = { pid: 2, instance_id: "b", session_id: "s", data_domain_id: "d" };
  restartOracle(before, after);
  assert.throws(() => restartOracle(before, { ...after, pid: 1 }));
  assert.throws(() => restartOracle(before, { ...after, session_id: "other" }));
  assert(!PROBE.includes(good.code));
}
type Call = {
  number: number;
  role: string;
  stage: string;
  phase: string;
  provider: string;
  model: string;
  pid: number;
  attempts: number;
  context_bytes: number;
  max_output_tokens: number;
  usage?: AssistantMessage["usage"];
  stop_reason?: string;
  error?: string;
};
type Ledger = {
  started_ms: number;
  calls: Call[];
  attempts: Array<{
    number: number;
    call: number;
    role: string;
    model: string;
    provider: string;
    stage: string;
    phase: string;
    pid: number;
    started_at: string;
    status?: number;
  }>;
  workers: any[];
};
const writeJSON = (file: string, value: unknown) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
function usage(ledger: Ledger) {
  const models = new Map<string, any>();
  for (const call of ledger.calls.filter((c) => c.attempts)) {
    const key = `${call.role}/${call.provider}/${call.model}`;
    const row = models.get(key) ?? {
      role: call.role,
      provider: call.provider,
      model: call.model,
      attempts: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      catalog_cost_usd: 0,
      missing_usage_attempts: 0,
    };
    row.attempts += call.attempts;
    if (call.usage) {
      for (const field of [
        "input",
        "output",
        "cacheRead",
        "cacheWrite",
        "totalTokens",
      ] as const)
        row[field] += call.usage[field];
      row.catalog_cost_usd += call.usage.cost.total;
    } else row.missing_usage_attempts += call.attempts;
    models.set(key, row);
  }
  return [...models.values()].map((row) => ({
    ...row,
    catalog_cost_usd: Number(row.catalog_cost_usd.toFixed(12)),
  }));
}

async function worker() {
  const directory = process.argv[process.argv.indexOf("--worker") + 1];
  const scenario = process.argv[
    process.argv.indexOf("--worker") + 2
  ] as Scenario;
  const phase = process.argv[process.argv.indexOf("--worker") + 3];
  process.umask(0o077);
  const ledgerPath = path.join(directory, "ledger.json");
  const ledger: Ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  const remaining = LIMITS.total_ms - (Date.now() - ledger.started_ms);
  assert(remaining > 0);
  for (const key of [
    "SECRETARY_MAIN_OUTPUT_TOKENS",
    "SECRETARY_TASK_OUTPUT_TOKENS",
    "SECRETARY_COMPACTION_OUTPUT_TOKENS",
    "SECRETARY_COMPACTION_RETRY_OUTPUT_TOKENS",
  ])
    process.env[key] = String(LIMITS.output_tokens);
  const credentialFile = process.env.SECRETARY_CREDENTIALS_FILE;
  assert(credentialFile);
  const stat = fs.lstatSync(credentialFile);
  assert(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0);
  const keys = JSON.parse(fs.readFileSync(credentialFile, "utf8")) as {
    main: string;
    task: string;
  };
  assert(
    [keys.main, keys.task].every(
      (key) => typeof key === "string" && key.length,
    ),
  );
  const clean = (value: unknown) =>
    [keys.main, keys.task].reduce(
      (text, key) => text.split(key).join("[REDACTED]"),
      String(value),
    );
  const save = (name: string, value: unknown) =>
    fs.writeFileSync(
      path.join(directory, name),
      clean(JSON.stringify(value, null, 2)) + "\n",
      { mode: 0o600 },
    );
  console.error = (...values) =>
    fs.appendFileSync(
      path.join(directory, "worker-errors.log"),
      values.map(clean).join(" ") + "\n",
      { mode: 0o600 },
    );
  const persist = () => save("ledger.json", ledger);
  let stage = "worker-open",
    transportFailed = false;
  const deadline = AbortSignal.timeout(remaining);
  const watchdog = setTimeout(() => {
    save("worker-timeout.json", { stage, pid: process.pid });
    process.exit(124);
  }, remaining);
  const active = new AsyncLocalStorage<Call>(),
    originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    assert.equal(
      url.hostname,
      "opencode.ai",
      "Worker network is limited to existing provider transport",
    );
    const call = active.getStore();
    assert(call, "UNCOUNTED_PROVIDER_FETCH");
    assert(
      !transportFailed &&
        !deadline.aborted &&
        ledger.attempts.length < ceiling(scenario, phase),
      "SCENARIO_ATTEMPT_LIMIT_OR_RECALL_RESERVE",
    );
    call.attempts++;
    const attempt = {
      number: ledger.attempts.length + 1,
      call: call.number,
      role: call.role,
      model: call.model,
      provider: call.provider,
      stage,
      phase,
      pid: process.pid,
      started_at: new Date().toISOString(),
      status: undefined as number | undefined,
    };
    ledger.attempts.push(attempt);
    persist();
    try {
      const response = await originalFetch(input, init);
      attempt.status = response.status;
      persist();
      return response;
    } catch (error) {
      transportFailed = true;
      persist();
      throw error;
    }
  };
  const configs = {} as {
    main: ReturnType<typeof roleModel>;
    task: ReturnType<typeof roleModel>;
  };
  for (const role of ["main", "task"] as const) {
    const provider = process.env[`SECRETARY_${role.toUpperCase()}_PROVIDER`],
      modelID = process.env[`SECRETARY_${role.toUpperCase()}_MODEL`];
    assert(provider === "opencode-go" && modelID);
    const model = getModel(provider, modelID as never);
    assert(
      model && ["openai-completions", "openai-responses"].includes(model.api),
    );
    const config = roleModel(model, keys[role], role);
    const stream: StreamFn = async (m, context, options) => {
      assert(
        !transportFailed &&
          !deadline.aborted &&
          ledger.attempts.length < ceiling(scenario, phase),
        "SCENARIO_ATTEMPT_LIMIT_OR_RECALL_RESERVE",
      );
      const allowed = new Set(
        role === "task" ? ["submit_result"] : ["memory_read", "task_query"],
      );
      const bounded = {
        ...context,
        messages: context.messages.map((message) =>
          message.role === "system"
            ? {
                ...message,
                toolsAdded: message.toolsAdded?.filter((tool) =>
                  allowed.has(tool.name),
                ),
              }
            : message,
        ),
      };
      const bytes = Buffer.byteLength(JSON.stringify(bounded));
      assert(bytes <= LIMITS.context_bytes, "SCENARIO_CONTEXT_LIMIT");
      assert(
        (options?.maxTokens ?? LIMITS.output_tokens) <= LIMITS.output_tokens,
        "UPSTREAM_OUTPUT_BUDGET_NOT_ALIGNED",
      );
      const call: Call = {
        number: ledger.calls.length + 1,
        role,
        stage,
        phase,
        provider: m.provider,
        model: m.id,
        pid: process.pid,
        attempts: 0,
        context_bytes: bytes,
        max_output_tokens: options?.maxTokens ?? LIMITS.output_tokens,
      };
      ledger.calls.push(call);
      save(`call-${call.number}-request.json`, bounded);
      persist();
      return active.run(call, async () => {
        const signal = AbortSignal.any([
          deadline,
          AbortSignal.timeout(LIMITS.request_ms),
          ...(options?.signal ? [options.signal] : []),
        ]);
        let onAbort: () => void = () => {};
        const aborted = new Promise<never>((_, reject) => {
          onAbort = () => reject(Error("SCENARIO_REQUEST_TIMEOUT"));
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        });
        void aborted.catch(() => {});
        try {
          const result = await Promise.race([
            (async () => {
              const source = await config.stream(m, bounded, {
                ...options,
                signal,
                maxTokens: call.max_output_tokens,
              });
              const events: AssistantMessageEvent[] = [];
              for await (const event of source) events.push(event);
              return { response: await source.result(), events };
            })(),
            aborted,
          ]);
          const response = result.response;
          call.stop_reason = response.stopReason;
          if (
            !["error", "aborted"].includes(response.stopReason) ||
            response.usage.totalTokens > 0
          )
            call.usage = response.usage;
          save(`call-${call.number}-response.json`, response);
          if (["error", "aborted"].includes(response.stopReason)) {
            transportFailed = true;
            throw Error("PROVIDER_RESPONSE_FAILED");
          }
          assert(
            response.content.every(
              (part) => part.type !== "toolCall" || allowed.has(part.name),
            ),
            "UNEXPECTED_TOOL_FORBIDDEN",
          );
          const output = createAssistantMessageEventStream();
          queueMicrotask(() => {
            result.events.forEach((event) => output.push(event));
            output.end(response);
          });
          return output;
        } catch (error) {
          call.error = clean(error);
          throw error;
        } finally {
          signal.removeEventListener("abort", onAbort);
          persist();
        }
      });
    };
    configs[role] = { model, stream };
  }
  const app = await App.open(path.join(directory, "store"), configs);
  const server = await serveCore(app, 0, undefined, { pump: false });
  ledger.workers.push({
    pid: process.pid,
    phase,
    started_at: new Date().toISOString(),
    session_id: app.host.sessionID,
    instance_id: server.endpoint.instance_id,
    data_domain_id: server.endpoint.data_domain_id,
  });
  persist();
  function snapshot() {
    let answer = "";
    if (app.host.session.last_context_id) {
      const c = app.store.get<Context>(
        "Context",
        app.host.session.last_context_id,
      );
      const messages = app.store.read<any[]>(c.raw_context);
      answer = contentText(
        messages
          .findLast((message) => message.role === "assistant")
          ?.content?.filter((part: any) => part.type === "text") ?? [],
      );
    }
    const executions = app.store
      .all<Execution>("Execution")
      .map((execution) => ({
        ...execution,
        proposal: app.scheduler.proposalFor(execution) as TaskProposal,
      }));
    return {
      pid: process.pid,
      session: app.host.session,
      answer,
      executions,
      inputs: app.store.all("Input"),
      tasks: app.store.all("TaskPlan"),
      operations: app.store.all("Operation"),
      authorizations: app.store.all("AuthorizationRequest"),
      model_calls: app.store.all("ModelCall"),
      settings_applications: app.store.all("SettingsApplication"),
      compaction_jobs: app.store.all("CompactionJob"),
      results: app.store.all("TaskResult"),
    };
  }
  let work = Promise.resolve();
  process.on("message", (message: any) => {
    work = work.then(async () => {
      try {
        if (message.command === "stage") stage = message.stage;
        else if (message.command === "host-drain") await app.host.drain();
        else if (message.command === "task-tick") {
          app.scheduler.tick();
          await app.scheduler.idle();
        } else if (message.command === "settings-tick")
          await app.settings.tick();
        else if (message.command === "snapshot") {
          const value = snapshot();
          save(`snapshot-${stage}.json`, value);
          process.send?.({ id: message.id, data: value });
          return;
        } else if (message.command === "close") {
          save(`snapshot-close-${phase}.json`, snapshot());
          await server.close();
          clearTimeout(watchdog);
          globalThis.fetch = originalFetch;
          ledger.workers.at(-1).closed_at = new Date().toISOString();
          persist();
          process.send?.(
            { id: message.id, data: { closed: true, pid: process.pid } },
            () => {
              process.disconnect();
              process.exit(0);
            },
          );
          return;
        } else throw Error("UNKNOWN_WORKER_CONTROL");
        process.send?.({ id: message.id, data: { ok: true } });
      } catch (error) {
        process.send?.({ id: message.id, error: clean(error) });
      }
    });
  });
  process.send?.({ ready: true, endpoint: server.endpoint, pid: process.pid });
}

type Handle = {
  child: ChildProcess;
  endpoint: CoreEndpoint;
  rpc: (command: string, extras?: object) => Promise<any>;
  close: () => Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
};
export async function runBoundedScenario() {
  const value = (flag: string) => process.argv[process.argv.indexOf(flag) + 1];
  const scenario = value("--scenario") as Scenario;
  assert(["task-chain", "memory-restart"].includes(scenario));
  assert(
    process.argv.includes("--live") && process.argv.includes("--evidence"),
  );
  const directory = path.resolve(value("--evidence"));
  assert(
    !fs.existsSync(directory),
    "Fresh private evidence directory required",
  );
  process.umask(0o077);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const started = Date.now(),
    checks: string[] = [];
  let current: Handle | undefined,
    pass = false,
    failure: any,
    processProof: any;
  writeJSON(path.join(directory, "ledger.json"), {
    started_ms: started,
    calls: [],
    attempts: [],
    workers: [],
  } satisfies Ledger);
  const readLedger = (): Ledger =>
    JSON.parse(fs.readFileSync(path.join(directory, "ledger.json"), "utf8"));
  const write = (name: string, value: unknown) =>
    writeJSON(path.join(directory, name), value);
  const manifestFiles = execFileSync(
    "git",
    [
      "ls-files",
      "src/pi_secretary/src",
      "src/pi_secretary/scripts",
      "docs/api/v1/schema.json",
      "src/contracts/contracts.schema.json",
      "package.json",
      "package-lock.json",
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n");
  manifestFiles.push(
    "test_case/online/test-api-v1-live.ts",
    "test_case/online/api-v1-online-worker.ts",
  );
  write("source-manifest.json", {
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    files: Object.fromEntries(
      manifestFiles.map((file) => [
        file,
        createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
      ]),
    ),
  });
  const watchdog = setTimeout(() => {
    current?.child.kill("SIGKILL");
    write("hard-timeout.json", { elapsed_ms: Date.now() - started });
    process.exitCode = 1;
  }, LIMITS.total_ms);
  async function start(phase: string): Promise<Handle> {
    const child = fork(
      fileURLToPath(import.meta.url),
      ["--worker", directory, scenario, phase],
      { execArgv: ["--import", "tsx"], silent: true },
    );
    const log = fs.createWriteStream(
      path.join(directory, `process-${phase}.log`),
      { flags: "wx", mode: 0o600 },
    );
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    child.once("close", () => log.end());
    const pending = new Map<
      number,
      { resolve: (value: any) => void; reject: (reason: any) => void }
    >();
    let sequence = 0;
    const ready = new Promise<{ endpoint: CoreEndpoint; pid: number }>(
      (resolve, reject) => {
        child.on("message", (message: any) => {
          if (message.ready) resolve(message);
          else {
            const waiter = pending.get(message.id);
            pending.delete(message.id);
            if (message.error) waiter?.reject(Error(message.error));
            else waiter?.resolve(message.data);
          }
        });
        child.on("error", reject);
        child.on("exit", (code, signal) => {
          const error = Error(`WORKER_EXIT:${code}:${signal}`);
          reject(error);
          for (const waiter of pending.values()) waiter.reject(error);
          pending.clear();
        });
      },
    );
    const endpoint = (await ready).endpoint;
    const rpc = (command: string, extras: object = {}) =>
      new Promise<any>((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        child.send({ id, command, ...extras });
      });
    return {
      child,
      endpoint,
      rpc,
      close: async () => {
        if (child.exitCode !== null || child.signalCode !== null)
          return { code: child.exitCode, signal: child.signalCode };
        const exit = once(child, "exit");
        await rpc("close");
        const [code, signal] = await exit;
        return { code, signal };
      },
    };
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Connection", "close");
    return originalFetch(input, { ...init, headers });
  };
  let client: CoreClient,
    stage = "setup";
  const setStage = async (value: string) => {
    stage = value;
    await current!.rpc("stage", { stage });
  };
  const query = async (route: string): Promise<any> => {
    const data = await client.query<any>(route);
    write(`${stage}-${route.replace(/[^a-z0-9-]/gi, "_")}.json`, data);
    return data;
  };
  const command = async (route: string, body: object = {}) => {
    const receipt = await client.command(route, {
      request_id: randomUUID(),
      ...body,
    });
    write(`${stage}-receipt-${receipt.request_id}.json`, receipt);
    return receipt;
  };
  const snapshot = () => current!.rpc("snapshot");
  async function turn(prompt: string) {
    await command("messages", { text: prompt });
    await current!.rpc("host-drain");
    const state = await snapshot();
    assert.equal(state.session.state, "IDLE");
    assert(state.inputs.every((input: any) => input.state === "HANDLED"));
    await query("timeline");
    return state.answer as string;
  }
  async function taskDone(taskID: string) {
    for (let tick = 0; tick < 12; tick++) {
      await current!.rpc("task-tick");
      const detail = await query(`tasks/${taskID}`);
      if (
        [
          "SUCCEEDED",
          "FAILED",
          "CANCELLED",
          "EXPIRED",
          "RESULT_UNKNOWN",
          "WAIT_AUTH",
          "WAIT_DECISION",
        ].includes(detail.latest_state)
      ) {
        assert.equal(detail.latest_state, "SUCCEEDED");
        return detail;
      }
    }
    throw Error("TASK_DID_NOT_REACH_SUCCESS");
  }
  try {
    current = await start("prepare");
    client = new CoreClient(current.endpoint);
    const core = await query("core");
    assert.equal(core.mode, "live");
    assert.equal(core.api_version, "1");
    if (scenario === "task-chain") {
      await setStage("task-first");
      const first = await command("task-requests", {
        goal: "Synthetic arithmetic: calculate 17 + 25. Include the exact numeric answer in the result summary. No external tools, files, shell or network are needed; submit the structured result directly.",
      });
      const taskID = first.resource_ids.find(
        (resource) => resource.type === "TaskPlan",
      )!.id;
      const firstDetail = await taskDone(taskID);
      assert.match(firstDetail.result.summary, /\b42\b/);
      const parentID = firstDetail.latest_execution_id;
      const parent = await query(`executions/${parentID}`);
      assert.equal(parent.state, "SUCCEEDED");
      assert.equal(parent.task_id, taskID);
      checks.push(
        "first API and durable task execution succeeded with result 42",
      );
      await setStage("task-continuation");
      await command("task-requests", {
        goal: "Continue the prior arithmetic result by multiplying it by two. Include the exact numeric answer in the result summary. No external tools or actions are needed; submit the structured result directly.",
        reuse_task_id: taskID,
        parent_execution_id: parentID,
      });
      const second = await taskDone(taskID);
      assert.match(second.result.summary, /\b84\b/);
      assert.notEqual(second.latest_execution_id, parentID);
      const secondView = await query(
        `executions/${second.latest_execution_id}`,
      );
      assert.equal(secondView.task_id, taskID);
      assert.equal(secondView.state, "SUCCEEDED");
      const state = await snapshot();
      assert.equal(state.tasks.length, 1);
      assert.equal(state.executions.length, 2);
      assert(
        state.executions.every(
          (execution: any) =>
            execution.state === "SUCCEEDED" &&
            execution.task_id === taskID &&
            !execution.unknown_operation_ids.length,
        ),
      );
      assert.equal(
        state.executions.find(
          (execution: any) => execution.id === second.latest_execution_id,
        ).proposal.parent_execution_id,
        parentID,
      );
      assert(
        readLedger().calls.filter(
          (call) => call.role === "task" && call.attempts > 0,
        ).length >= 2,
      );
      checks.push(
        "second execution of same task succeeded with parent identity and result 84",
      );
    } else {
      await setStage("source-facts");
      assert((await turn(SOURCE)).length > 0);
      checks.push("source facts sent through API to real main model");
      await setStage("settings-apply");
      const settings = await query("settings");
      await command("settings/draft", {
        expected_revision: settings.draft.revision,
        payload: {
          instructions: {
            content:
              "Always reply in English. Address the user as Master. Preserve exact project names, codes and dates.",
            expected_revision: settings.effective_instructions.revision,
          },
          edits: [],
          command_ids: [],
        },
      });
      const draft = await query("settings");
      await command("settings/apply", {
        expected_revision: draft.draft.revision,
      });
      await current!.rpc("settings-tick");
      assert.equal(
        (await query("settings")).applications.at(-1).state,
        "APPLIED",
      );
      checks.push("API settings applied");
      await setStage("pre-restart-recall");
      oracle(await turn(PROBE));
      checks.push("pre-restart real fact and active language oracle passed");
      await setStage("explicit-compaction");
      const before = readLedger().attempts.length;
      const compact = await command("session/compact");
      let receipt: any;
      for (let i = 0; i < 6000; i++) {
        assert(Date.now() - started < LIMITS.total_ms);
        receipt = await query(`requests/${compact.request_id}`);
        if (["COMPLETED", "FAILED", "UNKNOWN"].includes(receipt.receipt.state))
          break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(receipt.receipt.state, "COMPLETED");
      assert.equal((await query("memory")).state, "COMMITTED");
      assert(readLedger().attempts.length > before);
      assert(readLedger().attempts.length <= 10);
      checks.push(
        "explicit real compaction committed with two recall attempts reserved",
      );
      const prior = await query("core");
      const beforeStop = await snapshot();
      assert.equal(beforeStop.session.state, "IDLE");
      assert(
        beforeStop.inputs.every((input: any) => input.state === "HANDLED"),
      );
      assert(
        beforeStop.executions.every(
          (execution: any) =>
            ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(
              execution.state,
            ) && !execution.unknown_operation_ids.length,
        ),
      );
      const oldPID = current!.child.pid!;
      const exit = await current!.close();
      current = undefined;
      assert.equal(exit.code, 0);
      let alive = true;
      try {
        process.kill(oldPID, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false;
        else throw error;
      }
      current = await start("recall");
      client = new CoreClient(current.endpoint);
      await setStage("post-process-restart-recall");
      const next = await query("core");
      processProof = {
        before: {
          pid: oldPID,
          ...prior,
          exit_code: exit.code,
          old_pid_alive: alive,
        },
        after: { pid: current.child.pid, ...next },
      };
      restartOracle(processProof.before, processProof.after);
      write("process-restart-proof.json", processProof);
      checks.push(
        "clean OS process exit and fresh PID/instance with same Store identity",
      );
      assert.equal((await query("memory")).state, "COMMITTED");
      assert.equal(
        (await query("settings")).applications.at(-1).state,
        "APPLIED",
      );
      const beforeRecall = readLedger().attempts.length;
      oracle(await turn(PROBE));
      assert(readLedger().attempts.length > beforeRecall);
      assert(
        readLedger().attempts.some(
          (attempt) =>
            attempt.phase === "recall" && attempt.pid === current!.child.pid,
        ),
      );
      checks.push(
        "actual main transport after OS process restart passed exact fact and English oracle",
      );
    }
    const final = await snapshot();
    assert.equal(final.operations.length, 0);
    assert.equal(final.authorizations.length, 0);
    checks.push("zero external operations and authorization requests");
    assert(
      readLedger().attempts.length <= LIMITS.attempts &&
        Date.now() - started < LIMITS.total_ms,
    );
    pass = true;
  } catch (error) {
    failure = {
      stage,
      message: String(error),
      cause_code:
        (error as Error & { cause?: { code?: string } }).cause?.code ?? null,
    };
    process.exitCode = 1;
  } finally {
    if (current) {
      try {
        const stopped = await current.close();
        if (stopped.code !== 0) throw Error("UNCLEAN_WORKER_EXIT");
      } catch (error) {
        failure ??= { stage: "cleanup", message: String(error) };
        pass = false;
        current.child.kill("SIGKILL");
        process.exitCode = 1;
      }
    }
    clearTimeout(watchdog);
    globalThis.fetch = originalFetch;
    const ledger = readLedger();
    const report = {
      evidence: "REAL_PROVIDER_API_V1_SEPARATE_SCENARIO",
      scenario,
      pass,
      state: pass ? "completed" : "failed",
      limits: LIMITS,
      actual_attempts: ledger.attempts.length,
      elapsed_ms: Date.now() - started,
      checks,
      failure,
      models: usage(ledger),
      billing_cost: "unavailable",
      process_restart: processProof ?? null,
      test_controls: [
        "Production role budgets aligned to4096 before App open.",
        "Production validation retries retained within scenario budget; summary bounds unchanged.",
        "Memory preparation cannot consume final two provider attempts.",
        "API commands and queries use Connection:close without retry.",
        "Task scenario advances Scheduler only; main feedback delivery is outside task-chain scope.",
      ],
      limitations: [
        "Synthetic bounded test, no production readiness or long-term natural-memory claim.",
        "World/PostgreSQL and reliable SSE excluded.",
        "Task model tool surface restricted to submit_result; main tools restricted to read-only.",
        "SDK catalog cost is an estimate, actual billing unavailable.",
        "Recall may include host-retained original user anchors; this is product continuity, not summary-only memory.",
      ],
    };
    write("report.json", report);
    console.log(
      JSON.stringify({
        scenario,
        pass,
        actual_attempts: ledger.attempts.length,
        checks,
        failure,
        models: usage(ledger),
        report: path.join(directory, "report.json"),
      }),
    );
  }
}
if (process.argv.includes("--worker")) await worker();
