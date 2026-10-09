// Explicit paid-provider regression: API v1, synthetic data, private fresh Store.
// Run --self-check offline; real calls require --live and explicit configuration.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import {
  contentText,
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
} from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai/compat";
import { App } from "../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../src/pi_secretary/src/api-v1.ts";
import { CoreClient } from "../../src/pi_secretary/src/core-client.ts";
import { roleModel, type StreamFn } from "../../src/pi_secretary/src/model.ts";
import type {
  Context,
  Input,
  Execution,
  TaskResult,
} from "../../src/pi_secretary/src/contracts.ts";

const LIMITS = {
  attempts: Number(process.env.SECRETARY_ONLINE_ATTEMPT_BUDGET ?? 12),
  total_ms: Number(process.env.SECRETARY_ONLINE_TOTAL_MS ?? 15 * 60_000),
  request_ms: 90_000,
  output_tokens: 4096,
  context_bytes: 80_000,
};
assert(
  Number.isInteger(LIMITS.attempts) &&
    LIMITS.attempts >= 1 &&
    LIMITS.attempts <= 12,
  "Attempt budget must be 1..12",
);
assert(
  Number.isInteger(LIMITS.total_ms) &&
    LIMITS.total_ms >= 1000 &&
    LIMITS.total_ms <= 15 * 60_000,
  "Total timeout must be 1000..900000 ms",
);
const SOURCE =
  "Synthetic project CedarHarbor-Q7 has code AZURE-314 and deadline 2032-06-17. This is fictional test data. Remember these facts and acknowledge briefly; do not create tasks, use tools, make promises, or perform actions.";
const PROBE =
  "Recall the fictional project from our earlier conversation. Return only JSON with fields project, code, deadline, explanation. The explanation must follow the currently active language setting. Do not use tools or perform actions.";
function oracle(text: string) {
  const v = JSON.parse(
    text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, ""),
  );
  assert.equal(v.project, "CedarHarbor-Q7");
  assert.equal(v.code, "AZURE-314");
  assert.equal(v.deadline, "2032-06-17");
  assert.equal(typeof v.explanation, "string");
  assert(!/\p{Script=Han}/u.test(v.explanation));
  assert((v.explanation.match(/[A-Za-z]+/g) ?? []).length >= 5);
}
if (process.argv.includes("--self-check")) {
  const good = {
    project: "CedarHarbor-Q7",
    code: "AZURE-314",
    deadline: "2032-06-17",
    explanation:
      "The fictional project retains its recorded code and deadline.",
  };
  oracle(JSON.stringify(good));
  for (const field of ["project", "code", "deadline", "explanation"])
    assert.throws(() => oracle(JSON.stringify({ ...good, [field]: "wrong" })));
  assert(!PROBE.includes(good.code));
  const { scenarioSelfCheck } = await import("./api-v1-online-worker.ts");
  scenarioSelfCheck();
  console.log(
    "API-v1 live oracle, process identity and budget reserve self-check PASS; 0 provider attempts",
  );
} else if (process.argv.includes("--scenario")) {
  const { runBoundedScenario } = await import("./api-v1-online-worker.ts");
  await runBoundedScenario();
} else {
  const index = process.argv.indexOf("--evidence"),
    directory = process.argv[index + 1];
  assert(
    process.argv.includes("--live") && index >= 0 && directory,
    "Use --live --evidence NEW_PRIVATE_DIRECTORY, or --self-check",
  );
  await run(path.resolve(directory));
}

type Call = {
  number: number;
  role: string;
  stage: string;
  provider: string;
  model: string;
  context_bytes: number;
  max_output_tokens: number;
  attempts: number;
  usage?: AssistantMessage["usage"];
  stop_reason?: string;
  error?: string;
  elapsed_ms?: number;
};
async function run(directory: string) {
  const retryIndex = process.argv.indexOf("--retry-compaction-from");
  const retryFrom = retryIndex >= 0 ? process.argv[retryIndex + 1] : undefined;
  assert(
    retryIndex < 0 || retryFrom,
    "Retry requires previous private evidence directory",
  );
  const memoryOnly =
    process.argv.includes("--memory-settings-only") || !!retryFrom;
  // Align the existing production budget calculation before App creation; a
  // downstream-only cap would violate durableStream's exact output assertion.
  for (const key of [
    "SECRETARY_MAIN_OUTPUT_TOKENS",
    "SECRETARY_TASK_OUTPUT_TOKENS",
    "SECRETARY_COMPACTION_OUTPUT_TOKENS",
    "SECRETARY_COMPACTION_RETRY_OUTPUT_TOKENS",
  ])
    process.env[key] = String(LIMITS.output_tokens);
  process.umask(0o077);
  assert(
    !fs.existsSync(directory),
    "Preserve every failure: evidence directory must be new",
  );
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const started = Date.now(),
    calls: Call[] = [],
    attempts: object[] = [],
    checks: string[] = [];
  let stage = "setup",
    fatal: string | undefined,
    pass = false,
    app: App | undefined;
  let server: Awaited<ReturnType<typeof serveCore>> | undefined,
    client!: CoreClient;
  let secrets: string[] = [],
    blocked = false;
  const clean = (x: unknown) =>
    secrets.reduce(
      (s, key) => (key ? s.split(key).join("[REDACTED]") : s),
      String(x),
    );
  const write = (name: string, data: unknown) =>
    fs.writeFileSync(
      path.join(directory, name),
      clean(JSON.stringify(data, null, 2)) + "\n",
      { mode: 0o600 },
    );
  const summary = () => ({
    evidence: "REAL_PROVIDER_API_V1",
    scenario: retryFrom
      ? "explicit-compaction-retry-and-reopen"
      : memoryOnly
        ? "main-memory-settings"
        : "main-task-chain-memory-settings",
    pass,
    state: pass ? "completed" : fatal ? "failed" : "running",
    limits: LIMITS,
    actual_attempts: attempts.length,
    billing_cost: "unavailable",
    elapsed_ms: Date.now() - started,
    checks,
    calls,
    error: fatal,
    usage: calls.reduce(
      (s, c) => ({
        input: s.input + (c.usage?.input ?? 0),
        output: s.output + (c.usage?.output ?? 0),
        cacheRead: s.cacheRead + (c.usage?.cacheRead ?? 0),
        cacheWrite: s.cacheWrite + (c.usage?.cacheWrite ?? 0),
        totalTokens: s.totalTokens + (c.usage?.totalTokens ?? 0),
        catalog_cost_usd: s.catalog_cost_usd + (c.usage?.cost.total ?? 0),
        unavailable: s.unavailable + (c.attempts > 0 && !c.usage ? 1 : 0),
      }),
      {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        catalog_cost_usd: 0,
        unavailable: 0,
      },
    ),
    limitations: [
      "Synthetic scenario only; no production data or devices.",
      "Cost is SDK catalog estimate, not billing data.",
      "Settings test changes instructions only; World/PostgreSQL not exercised.",
      "Reopen is App/store restart in the same process, not OS process restart.",
      "API v1 polling only; reliable SSE is outside scope.",
      "Raw user input anchors may survive compaction; this is product continuity, not summary-only recall.",
    ],
  });
  const persist = () => {
    write("report.json", summary());
    write("attempts.json", attempts);
  };
  const watchdog = setTimeout(() => {
    blocked = true;
    fatal = "LIVE_TOTAL_TIMEOUT";
    pass = false;
    persist();
    process.exit(1);
  }, LIMITS.total_ms);
  const scope = new AsyncLocalStorage<Call>();
  const originalFetch = globalThis.fetch;
  const deadline = AbortSignal.timeout(LIMITS.total_ms);
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.hostname !== "opencode.ai") {
      // Isolated loopback API requests need no pool; avoid idle socket reuse.
      const headers = new Headers(init?.headers);
      headers.set("Connection", "close");
      try {
        return await originalFetch(input, { ...init, headers });
      } catch (error) {
        write("local-http-error.json", {
          stage,
          name: (error as Error).name,
          message: clean(error),
          cause_code:
            (error as Error & { cause?: { code?: string } }).cause?.code ??
            null,
        });
        throw error;
      }
    }
    const call = scope.getStore();
    assert(call, "Provider fetch outside counted role stream");
    assert(
      !blocked && !deadline.aborted && attempts.length < LIMITS.attempts,
      "LIVE_ATTEMPT_BUDGET_EXHAUSTED",
    );
    call.attempts++;
    const record = {
      number: attempts.length + 1,
      call: call.number,
      stage: call.stage,
      role: call.role,
      provider: call.provider,
      model: call.model,
      started_at: new Date().toISOString(),
      status: null as number | null,
    };
    attempts.push(record);
    persist();
    try {
      const response = await originalFetch(input, init);
      record.status = response.status;
      persist();
      return response;
    } catch (error) {
      blocked = true;
      persist();
      throw error;
    }
  };
  try {
    const credentialFile = process.env.SECRETARY_CREDENTIALS_FILE;
    assert(credentialFile, "Existing credentials file required");
    const stat = fs.lstatSync(credentialFile);
    assert(
      stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0,
      "Credential file must be private regular file",
    );
    // Existing credentials are loaded only inside this process into roleModel.
    const keys = JSON.parse(fs.readFileSync(credentialFile, "utf8")) as {
      main: string;
      task: string;
    };
    secrets = [keys.main, keys.task];
    assert(secrets.every((key) => typeof key === "string" && key.length > 0));
    const configs = {} as {
      main: ReturnType<typeof roleModel>;
      task: ReturnType<typeof roleModel>;
    };
    for (const role of ["main", "task"] as const) {
      const prefix = `SECRETARY_${role.toUpperCase()}`;
      const provider = process.env[`${prefix}_PROVIDER`],
        modelID = process.env[`${prefix}_MODEL`];
      assert(
        provider === "opencode-go" && modelID,
        "Explicit current OpenCode role provider/model required",
      );
      const model = getModel(provider, modelID as never);
      assert(
        model && ["openai-completions", "openai-responses"].includes(model.api),
        "Model must exist in installed catalog and supported production adapter",
      );
      const config = roleModel(model, keys[role], role);
      const stream: StreamFn = async (m, context, options) => {
        assert(
          !blocked && !deadline.aborted && attempts.length < LIMITS.attempts,
          "LIVE_BUDGET_EXHAUSTED",
        );
        const latest = context.messages.findLast(
          (message) => message.role === "user",
        );
        if (latest) {
          let packet: any;
          try {
            packet = JSON.parse(contentText(latest.content));
          } catch {}
          assert(
            !packet?.previous_error || (!!retryFrom && stage === "compact"),
            "Automatic validation retry is outside this test",
          );
        }
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
        assert(bytes <= LIMITS.context_bytes, "LIVE_CONTEXT_LIMIT");
        const call: Call = {
          number: calls.length + 1,
          role,
          stage,
          provider: m.provider,
          model: m.id,
          context_bytes: bytes,
          max_output_tokens: Math.min(
            options?.maxTokens ?? LIMITS.output_tokens,
            LIMITS.output_tokens,
          ),
          attempts: 0,
        };
        calls.push(call);
        write(`call-${call.number}-request.json`, bounded);
        persist();
        return scope.run(call, async () => {
          const at = Date.now();
          try {
            const signal = AbortSignal.any([
              deadline,
              AbortSignal.timeout(LIMITS.request_ms),
              ...(options?.signal ? [options.signal] : []),
            ]);
            const source = await config.stream(m, bounded, {
              ...options,
              signal,
              maxTokens: call.max_output_tokens,
            });
            const events: AssistantMessageEvent[] = [];
            for await (const event of source) events.push(event);
            const result = await source.result();
            if (
              !["error", "aborted"].includes(result.stopReason) ||
              result.usage.totalTokens > 0
            )
              call.usage = result.usage;
            call.stop_reason = result.stopReason;
            write(`call-${call.number}-response.json`, result);
            assert(
              !["error", "aborted"].includes(result.stopReason),
              "Provider response failed; inspect private response",
            );
            assert(
              result.content.every(
                (part) => part.type !== "toolCall" || allowed.has(part.name),
              ),
              "Unexpected tool forbidden",
            );
            const output = createAssistantMessageEventStream();
            queueMicrotask(() => {
              for (const event of events) output.push(event);
              output.end(result);
            });
            return output;
          } catch (error) {
            blocked = true;
            call.error = clean(error);
            throw error;
          } finally {
            call.elapsed_ms = Date.now() - at;
            persist();
          }
        });
      };
      configs[role] = { model, stream };
    }
    write("source-manifest.json", {
      commit: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      files: Object.fromEntries(
        [
          "test_case/online/test-api-v1-live.ts",
          "src/pi_secretary/src/application-service.ts",
          "src/pi_secretary/src/api-v1.ts",
          "src/pi_secretary/src/model.ts",
          "src/pi_secretary/src/host.ts",
          "src/pi_secretary/src/settings.ts",
          "src/pi_secretary/src/api/protocol.ts",
          "src/pi_secretary/src/store.ts",
          "src/pi_secretary/src/contracts.ts",
          "src/pi_secretary/src/api/contracts.ts",
          "docs/api/v1/schema.json",
        ].map((file) => [
          file,
          createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
        ]),
      ),
    });
    async function open() {
      app = await App.open(path.join(directory, "store"), configs);
      server = await serveCore(app, 0, undefined, { pump: false });
      client = new CoreClient(server.endpoint);
    }
    async function query(route: string) {
      const result = await client.query<any>(route);
      write(`${stage}-${route.replace(/[^a-z0-9-]/gi, "_")}.json`, result);
      return result;
    }
    async function command(route: string, body: Record<string, unknown> = {}) {
      const request = { request_id: randomUUID(), ...body };
      const receipt = await client.command(route, request);
      write(`${stage}-receipt-${request.request_id}.json`, receipt);
      return receipt;
    }
    function text() {
      const context = app!.store.get<Context>(
        "Context",
        app!.host.session.last_context_id!,
      );
      const messages = app!.store.read<any[]>(context.raw_context);
      return contentText(
        messages
          .findLast((message) => message.role === "assistant")
          ?.content?.filter((part: any) => part.type === "text") ?? [],
      );
    }
    async function turn(prompt: string) {
      const receipt = await command("messages", { text: prompt });
      await app!.settle();
      assert.equal(app!.host.session.state, "IDLE");
      assert(
        app!.store
          .all<Input>("Input")
          .every((input) => input.state === "HANDLED"),
      );
      await query(`requests/${receipt.request_id}`);
      await query("timeline");
      const answer = text();
      write(`${stage}-answer.json`, { answer });
      return answer;
    }
    if (retryFrom) {
      const previous = JSON.parse(
        fs.readFileSync(path.join(retryFrom, "report.json"), "utf8"),
      );
      assert.equal(previous.evidence, "REAL_PROVIDER_API_V1");
      assert.equal(previous.scenario, "main-memory-settings");
      assert.equal(previous.state, "failed");
      const jobs = JSON.parse(
        fs.readFileSync(
          path.join(retryFrom, "durable-compaction-jobs.json"),
          "utf8",
        ),
      );
      assert.equal(jobs.at(-1).state, "FAILED");
      assert(
        JSON.stringify(jobs.at(-1).validation_errors).includes(
          "SUMMARY_PRIOR_BOUND_EXCEEDED",
        ),
      );
      fs.cpSync(path.join(retryFrom, "store"), path.join(directory, "store"), {
        recursive: true,
        errorOnExist: true,
      });
      write("retry-source.json", {
        previous_report_sha256: createHash("sha256")
          .update(fs.readFileSync(path.join(retryFrom, "report.json")))
          .digest("hex"),
        original_failure: "SUMMARY_PRIOR_BOUND_EXCEEDED",
        production_bounds_unchanged: true,
      });
    }
    await open();
    stage = "main-conversation";
    const core = await query("core");
    assert.equal(core.api_version, "1");
    assert.equal(core.mode, "live");
    if (!retryFrom) {
      assert((await turn(SOURCE)).length > 0);
      checks.push("main conversation completed via API v1");
      if (!memoryOnly) {
        stage = "task-chain-first";
        const first = await command("task-requests", {
          goal: "Synthetic arithmetic analysis: compute 17 + 25. Return the exact numeric result in your summary. This requires no files, network, shell, or other external actions; submit your structured result directly.",
        });
        await app!.settle();
        const taskID = first.resource_ids.find(
          (resource) => resource.type === "TaskPlan",
        )!.id;
        let detail = await query(`tasks/${taskID}`);
        assert.equal(detail.latest_state, "SUCCEEDED");
        assert.match(detail.result.summary, /42/);
        checks.push(
          "first task API and durable result succeeded with arithmetic oracle",
        );
        const parentID = detail.latest_execution_id;
        stage = "task-chain-followup";
        await command("task-requests", {
          goal: "Continue the prior arithmetic result by multiplying it by two. Return the exact numeric result in the summary; no external tools or actions are needed.",
          reuse_task_id: taskID,
          parent_execution_id: parentID,
        });
        await app!.settle();
        detail = await query(`tasks/${taskID}`);
        assert.equal(detail.latest_state, "SUCCEEDED");
        assert.notEqual(detail.latest_execution_id, parentID);
        assert.match(detail.result.summary, /84/);
        assert.equal(app!.store.all("TaskPlan").length, 1);
        checks.push("real task model completed two linked API task requests");
      }
      stage = "settings-apply";
      const settings = await query("settings");
      await command("settings/draft", {
        expected_revision: settings.draft.revision,
        payload: {
          instructions: {
            content:
              "Always reply in English. Address the user as Master. Preserve exact synthetic project names, codes, and dates.",
            expected_revision: settings.effective_instructions.revision,
          },
          edits: [],
          command_ids: [],
        },
      });
      const updated = await query("settings");
      await command("settings/apply", {
        expected_revision: updated.draft.revision,
      });
      await app!.settings.tick();
      const applied = await query("settings");
      assert.equal(applied.applications.at(-1).state, "APPLIED");
      checks.push("API settings application reached APPLIED");
      stage = "settings-recall";
      oracle(await turn(PROBE));
      checks.push(
        "active English instructions and facts verified after settings apply",
      );
    } else {
      stage = "retry-preflight";
      const previousSettings = await query("settings");
      assert.equal(previousSettings.applications.at(-1).state, "APPLIED");
      assert.match(
        previousSettings.effective_instructions.content,
        /Always reply in English/,
      );
      assert.equal((await query("memory")).state, "FAILED");
      assert.equal(app!.store.all("TaskPlan").length, 0);
      checks.push(
        "copied synthetic Store preserves applied settings and failed compaction",
      );
    }
    const beforeCompactionCalls = attempts.length;
    stage = "compact";
    const compact = await command("session/compact");
    let state: any;
    for (let n = 0; n < 1200; n++) {
      deadline.throwIfAborted();
      state = await client.query<any>(`requests/${compact.request_id}`);
      if (["COMPLETED", "FAILED", "UNKNOWN"].includes(state.receipt.state))
        break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    write("compact-command.json", state);
    assert.equal(state.receipt.state, "COMPLETED");
    assert.equal((await query("memory")).state, "COMMITTED");
    await query("memory/summary");
    assert(
      attempts.length > beforeCompactionCalls,
      "Compaction must call real provider",
    );
    checks.push("API compaction completed with real provider");
    stage = "reopen-recall";
    const session = (await query("session")).id;
    await server!.close();
    server = undefined;
    app = undefined;
    await open();
    assert.equal((await query("session")).id, session);
    oracle(await turn(PROBE));
    checks.push(
      "facts and active English setting survived compaction and Store reopen",
    );
    assert.equal(app!.store.all("Operation").length, 0);
    assert.equal(app!.store.all("AuthorizationRequest").length, 0);
    if (!memoryOnly)
      assert(calls.some((call) => call.role === "task" && call.attempts > 0));
    assert(calls.some((call) => call.role === "main" && call.attempts > 0));
    assert(
      attempts.length <= LIMITS.attempts &&
        Date.now() - started < LIMITS.total_ms,
    );
    checks.push("bounded real calls; no operation or authorization created");
    pass = true;
  } catch (error) {
    fatal = clean(error);
    process.exitCode = 1;
  } finally {
    if (app) {
      write("durable-model-calls.json", app.store.all("ModelCall"));
      write(
        "durable-settings-applications.json",
        app.store.all("SettingsApplication"),
      );
      write("durable-compaction-jobs.json", app.store.all("CompactionJob"));
      write("durable-executions.json", app.store.all<Execution>("Execution"));
      write("durable-results.json", app.store.all<TaskResult>("TaskResult"));
    }
    try {
      await server?.close();
    } catch (error) {
      fatal = clean(error);
      pass = false;
      process.exitCode = 1;
    }
    clearTimeout(watchdog);
    globalThis.fetch = originalFetch;
    persist();
    console.log(
      JSON.stringify({
        pass,
        actual_attempts: attempts.length,
        checks,
        error: fatal,
        report: path.join(directory, "report.json"),
      }),
    );
  }
}
