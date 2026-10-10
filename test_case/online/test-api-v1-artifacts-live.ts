// Explicit live artifact acceptance; no production edits, fixture output or summary oracle.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import {
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
  Execution,
  TaskResult,
  Operation,
  AuthorizationRequest,
} from "../../src/pi_secretary/src/contracts.ts";

const LIMITS = {
  attempts: 12,
  total_ms: 600000,
  request_ms: 90000,
  output_tokens: 4096,
  context_bytes: 80000,
  shell_ms: 10000,
};
const MIN_PROVIDER_START_INTERVAL_MS = 20000;
function pacingDelay(previous: number, now: number) {
  return previous === 0
    ? 0
    : Math.max(0, MIN_PROVIDER_START_INTERVAL_MS - (now - previous));
}
const PROGRAM1 = `import json
import sys
operands = [17, 25]
payload = {"operation": "add", "operands": operands, "result": sum(operands)}
raw = (json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\\n").encode("utf-8")
with open("first.json", "xb") as output:
    output.write(raw)
sys.stdout.buffer.write(raw)
`;
const PROGRAM2 = `import hashlib
import json
import sys
from pathlib import Path
source = Path("first.json").read_bytes()
previous = json.loads(source)
assert previous["operation"] == "add"
assert previous["operands"] == [17, 25]
assert previous["result"] == sum(previous["operands"])
payload = {"operation": "multiply", "source_file": "first.json", "source_sha256": hashlib.sha256(source).hexdigest(), "source_result": previous["result"], "multiplier": 2, "result": previous["result"] * 2}
raw = (json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\\n").encode("utf-8")
with open("second.json", "xb") as output:
    output.write(raw)
sys.stdout.buffer.write(raw)
`;
type Phase = "first" | "second";
const names = (phase: Phase) =>
  phase === "first"
    ? {
        program: "stage1.py",
        result: "first.json",
        source: PROGRAM1,
        command: "/usr/bin/python3 -I -S -B stage1.py",
      }
    : {
        program: "stage2.py",
        result: "second.json",
        source: PROGRAM2,
        command: "/usr/bin/python3 -I -S -B stage2.py",
      };
const sha = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function normalizedProgram(value: unknown) {
  assert.equal(typeof value, "string");
  return (value as string).replace(/\n?$/, "\n");
}
function validateTool(phase: Phase, name: string, args: any) {
  const permitted = names(phase);
  if (name === "write") {
    assert.equal(args.path, permitted.program);
    assert.equal(normalizedProgram(args.content), permitted.source);
  } else if (name === "bash") {
    assert.equal(args.command, permitted.command);
    assert.equal(args.timeout, 10);
  } else if (name === "read") {
    assert(
      [
        permitted.program,
        permitted.result,
        ...(phase === "second" ? ["first.json"] : []),
      ].includes(args.path),
    );
  } else if (name === "submit_result") {
    assert.equal(args.outcome, "SUCCEEDED");
    assert.deepEqual(
      [...args.artifacts].sort(),
      [permitted.program, permitted.result].sort(),
    );
  } else throw Error("UNAUTHORIZED_TOOL");
}
function bytesOracle(first: Buffer, second?: Buffer) {
  const a = JSON.parse(first.toString());
  assert.deepEqual(Object.keys(a).sort(), ["operands", "operation", "result"]);
  assert.equal(a.operation, "add");
  assert.deepEqual(a.operands, [17, 25]);
  assert.equal(
    a.result,
    a.operands.reduce((sum: number, number: number) => sum + number, 0),
  );
  assert.equal(a.result, 42);
  if (second) {
    const b = JSON.parse(second.toString());
    assert.deepEqual(Object.keys(b).sort(), [
      "multiplier",
      "operation",
      "result",
      "source_file",
      "source_result",
      "source_sha256",
    ]);
    assert.equal(b.operation, "multiply");
    assert.equal(b.source_file, "first.json");
    assert.equal(b.source_sha256, sha(first));
    assert.equal(b.source_result, a.result);
    assert.equal(b.multiplier, 2);
    assert.equal(b.result, a.result * b.multiplier);
    assert.equal(b.result, 84);
  }
}
function runApprovedProgram(directory: string, program: string) {
  const child = spawnSync("/usr/bin/python3", ["-I", "-S", "-B", program], {
    cwd: directory,
    encoding: "utf8",
    timeout: LIMITS.shell_ms,
    maxBuffer: 16384,
    env: { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" },
  });
  assert.equal(child.status, 0, "Independent program execution failed");
  assert.equal(child.signal, null);
  assert.equal(child.stderr, "");
  return Buffer.from(child.stdout);
}
function selfCheck() {
  assert.equal(pacingDelay(0, 1000), 0);
  assert.equal(pacingDelay(1000, 1000), 20000);
  assert.equal(pacingDelay(1000, 5000), 16000);
  assert.equal(pacingDelay(1000, 21000), 0);
  assert(!/\b(?:42|84)\b/.test(PROGRAM1 + PROGRAM2));
  for (const phase of ["first", "second"] as const) {
    const n = names(phase);
    validateTool(phase, "write", { path: n.program, content: n.source });
    validateTool(phase, "bash", { command: n.command, timeout: 10 });
    assert.throws(() =>
      validateTool(phase, "write", { path: "../escape", content: n.source }),
    );
    assert.throws(() =>
      validateTool(phase, "write", {
        path: n.program,
        content: n.source + "print('extra')",
      }),
    );
    assert.throws(() =>
      validateTool(phase, "bash", {
        command: n.command + "; true",
        timeout: 10,
      }),
    );
    assert.throws(() =>
      validateTool(phase, "bash", { command: n.command, timeout: 120 }),
    );
    assert.throws(() => validateTool(phase, "read", { path: "/etc/passwd" }));
    assert.throws(() =>
      validateTool(phase, "submit_result", {
        outcome: "SUCCEEDED",
        artifacts: [],
      }),
    );
  }
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "secretary-artifact-oracle-offline-"),
  );
  try {
    fs.writeFileSync(path.join(directory, "stage1.py"), PROGRAM1);
    fs.writeFileSync(path.join(directory, "stage2.py"), PROGRAM2);
    const a = runApprovedProgram(directory, "stage1.py"),
      b = runApprovedProgram(directory, "stage2.py");
    assert(a.equals(fs.readFileSync(path.join(directory, "first.json"))));
    assert(b.equals(fs.readFileSync(path.join(directory, "second.json"))));
    bytesOracle(a, b);
    assert.throws(() =>
      bytesOracle(
        Buffer.from(a.toString().replace('"result":42', '"result":43')),
        b,
      ),
    );
    assert.throws(() =>
      bytesOracle(
        a,
        Buffer.from(b.toString().replace('"result":84', '"result":85')),
      ),
    );
    const tampered = JSON.parse(b.toString());
    tampered.source_sha256 = "0".repeat(64);
    assert.throws(() => bytesOracle(a, Buffer.from(JSON.stringify(tampered))));
    assert.throws(
      () => runApprovedProgram(directory, "stage1.py"),
      "Exclusive creation must prevent overwrite",
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  console.log(
    "Artifact allowlist, real local program and independent byte oracle self-check PASS; 0 provider attempts",
  );
}
if (process.argv.includes("--self-check")) selfCheck();
else {
  const index = process.argv.indexOf("--evidence");
  assert(
    process.argv.includes("--live") && index >= 0 && process.argv[index + 1],
    "Use --live --evidence NEW_PRIVATE_DIRECTORY or --self-check",
  );
  await run(path.resolve(process.argv[index + 1]));
}

type Call = {
  number: number;
  phase: Phase;
  attempts: number;
  provider: string;
  model: string;
  stopReason?: string;
  usage?: AssistantMessage["usage"];
  error?: string;
  context_bytes: number;
};
async function run(directory: string) {
  assert(!fs.existsSync(directory));
  process.umask(0o077);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const started = Date.now(),
    deadline = AbortSignal.timeout(LIMITS.total_ms),
    calls: Call[] = [],
    attempts: any[] = [],
    checks: string[] = [],
    toolCalls: any[] = [],
    approvals: any[] = [],
    downloads: any[] = [],
    apiHttp: any[] = [];
  let firstArtifactBytes: Buffer | undefined;
  let phase: Phase = "first",
    app: App | undefined,
    server: Awaited<ReturnType<typeof serveCore>> | undefined,
    client: CoreClient,
    pass = false,
    failure: any,
    secret = "",
    transportFailed = false,
    previousProviderStart = 0;
  const clean = (value: unknown) =>
    secret ? String(value).split(secret).join("[REDACTED]") : String(value);
  const write = (name: string, value: unknown) =>
    fs.writeFileSync(
      path.join(directory, name),
      clean(JSON.stringify(value, null, 2)) + "\n",
      { mode: 0o600 },
    );
  const metrics = () =>
    calls.reduce(
      (sum, call) => ({
        input: sum.input + (call.usage?.input ?? 0),
        output: sum.output + (call.usage?.output ?? 0),
        cacheRead: sum.cacheRead + (call.usage?.cacheRead ?? 0),
        cacheWrite: sum.cacheWrite + (call.usage?.cacheWrite ?? 0),
        totalTokens: sum.totalTokens + (call.usage?.totalTokens ?? 0),
        catalog_cost_usd: sum.catalog_cost_usd + (call.usage?.cost.total ?? 0),
        missing_usage_attempts:
          sum.missing_usage_attempts +
          (call.attempts && !call.usage ? call.attempts : 0),
      }),
      {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        catalog_cost_usd: 0,
        missing_usage_attempts: 0,
      },
    );
  const persist = () => {
    write("calls.json", calls);
    write("attempts.json", attempts);
    write("tool-calls.json", toolCalls);
    write("approvals.json", approvals);
  };
  const watchdog = setTimeout(() => {
    write("hard-timeout.json", { phase, elapsed_ms: Date.now() - started });
    process.exit(124);
  }, LIMITS.total_ms);
  const originalFetch = globalThis.fetch,
    active = new AsyncLocalStorage<Call>();
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.hostname === "127.0.0.1") {
      const headers = new Headers(init?.headers);
      headers.set("Connection", "close");
      const response = await originalFetch(input, { ...init, headers });
      apiHttp.push({
        phase,
        method: init?.method ?? "GET",
        route: url.pathname + url.search,
        status: response.status,
      });
      write("api-http.json", apiHttp);
      return response;
    }
    assert.equal(url.hostname, "opencode.ai");
    const call = active.getStore();
    assert(call, "UNCOUNTED_PROVIDER_FETCH");
    assert(
      !transportFailed &&
        !deadline.aborted &&
        attempts.length < LIMITS.attempts,
      "LIVE_PROVIDER_BUDGET",
    );
    const waitMs = pacingDelay(previousProviderStart, Date.now());
    if (waitMs > 0) {
      const pacingSignal = AbortSignal.any([
        deadline,
        ...(init?.signal ? [init.signal] : []),
      ]);
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(Error("LIVE_PACING_ABORTED"));
        };
        const timer = setTimeout(() => {
          pacingSignal.removeEventListener("abort", onAbort);
          resolve();
        }, waitMs);
        if (pacingSignal.aborted) onAbort();
        else pacingSignal.addEventListener("abort", onAbort, { once: true });
      });
    }
    assert(
      !transportFailed &&
        !deadline.aborted &&
        attempts.length < LIMITS.attempts,
      "LIVE_PROVIDER_BUDGET",
    );
    previousProviderStart = Date.now();
    call.attempts++;
    const attempt = {
      number: attempts.length + 1,
      call: call.number,
      phase,
      started_at: new Date(previousProviderStart).toISOString(),
      pacing_wait_ms: waitMs,
      status: null as number | null,
    };
    attempts.push(attempt);
    persist();
    try {
      const response = await originalFetch(input, init);
      attempt.status = response.status;
      persist();
      return response;
    } catch (error) {
      transportFailed = true;
      throw error;
    }
  };
  try {
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
    assert(
      stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0,
    );
    secret = JSON.parse(fs.readFileSync(credentialFile, "utf8")).task;
    assert(typeof secret === "string" && secret.length);
    const provider = process.env.SECRETARY_TASK_PROVIDER,
      modelID = process.env.SECRETARY_TASK_MODEL;
    assert(provider === "opencode-go" && modelID);
    const model = getModel(provider, modelID as never);
    assert(model);
    const config = roleModel(model, secret, "task");
    const stream: StreamFn = async (m, context, options) => {
      assert(
        !transportFailed &&
          !deadline.aborted &&
          attempts.length < LIMITS.attempts,
        "LIVE_PROVIDER_BUDGET",
      );
      assert(
        (options?.maxTokens ?? LIMITS.output_tokens) <= LIMITS.output_tokens,
      );
      const allowed = new Set(["read", "write", "bash", "submit_result"]);
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
      assert(bytes <= LIMITS.context_bytes);
      const call: Call = {
        number: calls.length + 1,
        phase,
        attempts: 0,
        provider: m.provider,
        model: m.id,
        context_bytes: bytes,
      };
      calls.push(call);
      write(`call-${call.number}-request.json`, bounded);
      persist();
      return active.run(call, async () => {
        const signal = AbortSignal.any([
          deadline,
          AbortSignal.timeout(LIMITS.request_ms),
          ...(options?.signal ? [options.signal] : []),
        ]);
        let abortHandler: () => void = () => {};
        const aborted = new Promise<never>((_, reject) => {
          abortHandler = () => reject(Error("LIVE_REQUEST_TIMEOUT"));
          if (signal.aborted) abortHandler();
          else signal.addEventListener("abort", abortHandler, { once: true });
        });
        void aborted.catch(() => {});
        try {
          const completed = await Promise.race([
            (async () => {
              const source = await config.stream(m, bounded, {
                ...options,
                signal,
                maxTokens: options?.maxTokens ?? LIMITS.output_tokens,
              });
              const events: AssistantMessageEvent[] = [];
              for await (const event of source) events.push(event);
              return { result: await source.result(), events };
            })(),
            aborted,
          ]);
          const result = completed.result;
          call.stopReason = result.stopReason;
          if (
            !["error", "aborted"].includes(result.stopReason) ||
            result.usage.totalTokens
          )
            call.usage = result.usage;
          write(`call-${call.number}-response.json`, result);
          assert(
            !["error", "aborted"].includes(result.stopReason),
            "PROVIDER_FAILED",
          );
          const requested = result.content.filter(
            (part) => part.type === "toolCall",
          );
          assert(
            requested.length <= 1,
            "One bounded tool action per response required",
          );
          for (const tool of requested) {
            validateTool(phase, tool.name, tool.arguments);
            if (tool.name === "bash") {
              const running = app!.store
                .all<Execution>("Execution")
                .find((execution) => execution.state === "RUNNING");
              assert(running);
              assert(
                !fs.existsSync(
                  path.join(
                    app!.store.dir,
                    "workspaces",
                    running.task_id,
                    "work",
                    names(phase).result,
                  ),
                ),
                "REPEATED_SHELL_EFFECT_FORBIDDEN",
              );
            }
            toolCalls.push({
              phase,
              call: call.number,
              name: tool.name,
              arguments: tool.arguments,
              tool_call_id: tool.id,
            });
          }
          const output = createAssistantMessageEventStream();
          queueMicrotask(() => {
            completed.events.forEach((event) => output.push(event));
            output.end(result);
          });
          return output;
        } catch (error) {
          call.error = clean(error);
          transportFailed = true;
          throw error;
        } finally {
          signal.removeEventListener("abort", abortHandler);
          persist();
        }
      });
    };
    const noMain: StreamFn = () => {
      throw Error("MAIN_MODEL_OUTSIDE_ARTIFACT_SCENARIO");
    };
    app = await App.open(path.join(directory, "store"), {
      task: { model, stream },
      main: { model, stream: noMain },
    });
    server = await serveCore(app, 0, undefined, { pump: false });
    client = new CoreClient(server.endpoint);
    const files = execFileSync(
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
    files.push("test_case/online/test-api-v1-artifacts-live.ts");
    write("source-manifest.json", {
      commit: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      files: Object.fromEntries(
        files.map((file) => [file, sha(fs.readFileSync(file))]),
      ),
    });
    const query = async (route: string): Promise<any> => {
      const data = await client.query<any>(route);
      write(`${phase}-${route.replace(/[^a-z0-9-]/gi, "_")}.json`, data);
      return data;
    };
    const command = async (route: string, body: object = {}) => {
      const receipt = await client.command(route, {
        request_id: randomUUID(),
        ...body,
      });
      write(`${phase}-receipt-${receipt.request_id}.json`, receipt);
      return receipt;
    };
    const core = await query("core");
    assert.equal(core.mode, "live");
    assert.equal(core.api_version, "1");
    function goal(stage: Phase) {
      const n = names(stage);
      return `Synthetic artifact acceptance. ${stage === "first" ? "Create and run the following small arithmetic program." : "Continue this same task. First use read on the actual first.json produced by the previous execution, then create and run the following program, which consumes those exact bytes."} The approved write is only ${n.program}; its content must be exactly the source below (one terminal newline is permitted). The only approved shell command is ${n.command}, timeout exactly 10 seconds. Execute at most one tool call per response. After WAIT_AUTH, stop and wait for Master authorization; never claim execution before its durable receipt. Do not repeat the shell command or overwrite any result. Do not write JSON outputs yourself; the program must generate them. Once shell execution succeeds, submit_result must include exactly ${n.program} and ${n.result} as existing artifacts and assess every acceptance criterion. No other file, shell command, external read or network access is authorized.\nSOURCE START\n${n.source}SOURCE END`;
    }
    async function advance(taskID: string) {
      for (let step = 0; step < 24; step++) {
        deadline.throwIfAborted();
        app!.scheduler.tick();
        await app!.scheduler.idle();
        const executions = app!.store.all<Execution>("Execution"),
          current = executions.at(-1)!;
        assert.equal(current.task_id, taskID);
        assert(
          !executions.some(
            (execution) =>
              execution.state === "RESULT_UNKNOWN" ||
              execution.unknown_operation_ids.length,
          ),
          "UNKNOWN_EFFECT_STOP",
        );
        assert(
          !app!.store
            .all<Operation>("Operation")
            .some(
              (operation) =>
                operation.state === "RESULT_UNKNOWN" ||
                operation.effect === "UNKNOWN",
            ),
          "UNKNOWN_OPERATION_STOP",
        );
        if (current.state === "SUCCEEDED") {
          const detail = await query(`tasks/${taskID}`);
          assert.equal(detail.latest_state, "SUCCEEDED");
          return current;
        }
        assert.equal(
          current.state,
          "WAIT_AUTH",
          "Unexpected execution state; preserve and stop",
        );
        const pending = (await query("authorizations")).items.filter(
          (a: any) =>
            a.scope.execution_id === current.id && a.state === "PENDING",
        );
        assert.equal(pending.length, 1);
        const authorization = await query(`authorizations/${pending[0].id}`);
        const op = app!.store.get<Operation>(
          "Operation",
          authorization.operation_id,
        );
        assert.equal(op.state, "WAIT_AUTH");
        assert.equal(op.effect, "NOT_STARTED");
        assert.equal(op.scope.execution_id, current.id);
        const params = app!.store.read<any>(op.action.parameters_ref),
          display = authorization.display;
        assert.deepEqual(display.parameters, params);
        assert.equal(display.action.resource, op.action.resource);
        const cwd = path.join(app!.store.dir, "workspaces", taskID, "work"),
          n = names(phase);
        assert.equal(fs.realpathSync(cwd), cwd);
        const expectedEntries =
          phase === "first" ? [] : ["first.json", "stage1.py"];
        if (op.action.action === "shell.run") expectedEntries.push(n.program);
        assert.deepEqual(
          fs.readdirSync(cwd).sort(),
          expectedEntries.sort(),
          "Unexpected workspace entry before approved action",
        );
        for (const entry of expectedEntries) {
          const entryStat = fs.lstatSync(path.join(cwd, entry));
          assert(
            entryStat.isFile() && !entryStat.isSymbolicLink(),
            "Only regular non-symlink inputs and scripts allowed",
          );
        }
        if (op.action.action === "file.write") {
          validateTool(phase, "write", params);
          assert.equal(op.action.resource, path.join(cwd, n.program));
          assert.equal(op.action.expected_resource_revision, "ABSENT");
          assert(!fs.existsSync(op.action.resource));
        } else {
          assert.equal(op.action.action, "shell.run");
          validateTool(phase, "bash", params);
          assert.equal(params.cwd, cwd);
          assert.equal(op.action.resource, cwd);
          assert.equal(
            normalizedProgram(
              fs.readFileSync(path.join(cwd, n.program), "utf8"),
            ),
            n.source,
          );
          assert(!fs.existsSync(path.join(cwd, n.result)));
        }
        if (approvals.length === 0) {
          await assert.rejects(
            client.command(`authorizations/${authorization.id}/decision`, {
              request_id: randomUUID(),
              expected_revision: authorization.revision,
              display_hash: "0".repeat(64),
              decision: "APPROVE",
            }),
            /APPROVAL_CONFLICT/,
          );
          const unchanged = await query(`authorizations/${authorization.id}`);
          assert.equal(unchanged.state, "PENDING");
          assert.equal(
            app!.store.get<Operation>("Operation", op.id).state,
            "WAIT_AUTH",
          );
          assert.equal(
            app!.store.get<Operation>("Operation", op.id).receipt,
            null,
          );
          checks.push(
            "API rejects wrong display hash without authorizing or dispatching operation",
          );
        }
        approvals.push({
          phase,
          authorization_id: authorization.id,
          operation_id: op.id,
          action: op.action.action,
          parameters_hash: op.action.parameters_hash,
          resource: op.action.resource,
          expected_revision: authorization.revision,
          display_hash: authorization.display_hash,
        });
        persist();
        await command(`authorizations/${authorization.id}/decision`, {
          expected_revision: authorization.revision,
          display_hash: authorization.display_hash,
          decision: "APPROVE",
        });
      }
      throw Error("BOUNDED_SCHEDULER_STEPS_EXHAUSTED");
    }
    async function artifacts(execution: Execution) {
      const n = names(phase),
        result = app!.store.get<TaskResult>("TaskResult", execution.result_id!);
      assert.equal(result.verified_by, "NOT_VERIFIED");
      assert.equal(result.artifacts.length, 2);
      const detail = app!.store.read<any>(result.detail_ref);
      assert.equal(detail.structured_result.outcome, "SUCCEEDED");
      assert.deepEqual(
        [...detail.structured_result.artifacts].sort(),
        [n.program, n.result].sort(),
      );
      assert.equal(detail.artifacts.length, 2);
      const view = await query(`executions/${execution.id}`);
      assert.equal(view.state, "SUCCEEDED");
      assert.equal(view.task_id, execution.task_id);
      assert.equal(view.result.artifact_ids.length, 2);
      const listed = (await query(`artifacts?task_id=${execution.task_id}`))
        .items;
      const outputs = new Map<string, Buffer>();
      for (const name of [n.program, n.result]) {
        const artifact = result.artifacts.find((value) => value.name === name)!;
        assert(artifact);
        assert(view.result.artifact_ids.includes(artifact.artifact_id));
        assert(
          listed.some(
            (value: any) =>
              value.id === artifact.artifact_id &&
              value.execution_id === execution.id,
          ),
        );
        const meta = await query(`artifacts/${artifact.artifact_id}`);
        assert.equal(meta.state, "available");
        assert.equal(meta.task_id, execution.task_id);
        assert.equal(meta.execution_id, execution.id);
        assert.equal(meta.name, name);
        const response = await fetch(
          server!.endpoint.url +
            `/api/v1/artifacts/${artifact.artifact_id}/content`,
          {
            headers: {
              Authorization: `Bearer ${server!.endpoint.token}`,
              "X-Secretary-API-Version": "1",
            },
            signal: AbortSignal.timeout(10000),
          },
        );
        assert.equal(response.status, 200);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(String(bytes.length), meta.bytes);
        assert.equal(response.headers.get("content-length"), meta.bytes);
        assert.equal(sha(bytes), meta.content_version);
        assert.equal(response.headers.get("etag"), `"${meta.content_version}"`);
        assert.equal(sha(bytes), artifact.content.sha256);
        assert(bytes.equals(app!.store.bytes(artifact.content)));
        const workspace = path.join(
          app!.store.dir,
          "workspaces",
          execution.task_id,
          "work",
          name,
        );
        assert(bytes.equals(fs.readFileSync(workspace)));
        fs.writeFileSync(path.join(directory, `download-${name}`), bytes, {
          mode: 0o600,
        });
        outputs.set(name, bytes);
        downloads.push({
          phase,
          artifact_id: artifact.artifact_id,
          name,
          task_id: meta.task_id,
          execution_id: meta.execution_id,
          http_status: response.status,
          bytes: bytes.length,
          sha256: sha(bytes),
          etag: response.headers.get("etag"),
          producing_operation_id: artifact.producing_operation_id,
        });
      }
      assert.equal(
        normalizedProgram(outputs.get(n.program)!.toString()),
        n.source,
      );
      const operations = app!.store
        .all<Operation>("Operation")
        .filter((op) => op.scope.execution_id === execution.id);
      assert.equal(operations.length, 2);
      assert(
        operations.every(
          (op) => op.state === "SUCCEEDED" && op.effect === "APPLIED",
        ),
      );
      const writeOp = operations.find(
          (op) => op.action.action === "file.write",
        )!,
        shell = operations.find((op) => op.action.action === "shell.run")!;
      assert(writeOp && shell);
      const params = app!.store.read<any>(shell.action.parameters_ref);
      assert.equal(params.command, n.command);
      const receipt = app!.store.read<any>(shell.receipt!);
      assert.equal(receipt.exit_code, 0);
      assert.equal(receipt.signal, null);
      assert.equal(receipt.timed_out, false);
      assert.equal(receipt.truncated, false);
      assert.equal(receipt.stderr, "");
      assert(Buffer.from(receipt.stdout).equals(outputs.get(n.result)!));
      write(`${phase}-provenance.json`, {
        execution,
        result,
        operations: operations.map((operation) => ({
          ...operation,
          parameters: app!.store.read(operation.action.parameters_ref),
          receipt: operation.receipt
            ? app!.store.read(operation.receipt)
            : null,
        })),
        artifact_downloads: downloads.filter(
          (download) => download.phase === phase,
        ),
      });
      const transcript = app!.store.logs
        .filter(
          (event) =>
            event.event_type === "agent.message" &&
            event.scope.execution_id === execution.id,
        )
        .map((event) => app!.store.read<any>(event.payload));
      write(`${phase}-agent-transcript.json`, transcript);
      const requested = transcript
        .filter((message) => message.role === "assistant")
        .flatMap((message) =>
          message.content.filter((part: any) => part.type === "toolCall"),
        );
      assert(
        requested.some(
          (tool) => tool.name === "write" && tool.arguments.path === n.program,
        ),
      );
      assert(
        requested.some(
          (tool) =>
            tool.name === "bash" && tool.arguments.command === n.command,
        ),
      );
      assert(requested.some((tool) => tool.name === "submit_result"));
      if (phase === "second") {
        const read = requested.find(
          (tool) =>
            tool.name === "read" && tool.arguments.path === "first.json",
        );
        assert(read, "Continuation must read first real artifact");
        const response = transcript.find(
          (message) =>
            message.role === "toolResult" && message.toolCallId === read.id,
        );
        assert(
          response && !response.isError,
          "First artifact read must have a successful durable tool result",
        );
        assert(firstArtifactBytes);
        const readText = response.content
          .filter((part: any) => part.type === "text")
          .map((part: any) => part.text)
          .join("\n");
        assert(
          readText.includes(firstArtifactBytes.toString().trimEnd()),
          "Durable successful read must contain the API-downloaded first artifact JSON bytes",
        );
        write("second-first-artifact-read-proof.json", {
          tool_call_id: read.id,
          expected_api_sha256: sha(firstArtifactBytes),
          exact_json_line_present: true,
        });
      }
      return outputs;
    }
    const accepted = await command("task-requests", { goal: goal("first") });
    const taskID = accepted.resource_ids.find(
      (resource) => resource.type === "TaskPlan",
    )!.id;
    const first = await advance(taskID),
      firstOutputs = await artifacts(first);
    firstArtifactBytes = firstOutputs.get("first.json")!;
    bytesOracle(firstArtifactBytes);
    checks.push(
      "first model-driven write and shell output downloaded via API and independently equals 17+25=42",
    );
    phase = "second";
    await command("task-requests", {
      goal: goal("second"),
      reuse_task_id: taskID,
      parent_execution_id: first.id,
    });
    const second = await advance(taskID),
      secondOutputs = await artifacts(second);
    assert.equal(second.task_id, first.task_id);
    assert.notEqual(second.id, first.id);
    assert.equal(second.continuation_of, first.id);
    assert.equal(
      app!.scheduler.proposalFor(second).parent_execution_id,
      first.id,
    );
    assert.equal(app!.store.all("TaskPlan").length, 1);
    assert.equal(app!.store.all("Execution").length, 2);
    bytesOracle(
      firstOutputs.get("first.json")!,
      secondOutputs.get("second.json")!,
    );
    checks.push(
      "same-task continuation consumed first artifact bytes/hash and independently equals prior result times2=84",
    );
    const firstResult = app!.store.get<TaskResult>(
      "TaskResult",
      first.result_id!,
    );
    const firstArtifact = firstResult.artifacts.find(
      (artifact) => artifact.name === "first.json",
    )!;
    const unchangedMeta = await query(`artifacts/${firstArtifact.artifact_id}`);
    const recheck = await fetch(
      server!.endpoint.url +
        `/api/v1/artifacts/${firstArtifact.artifact_id}/content`,
      {
        headers: {
          Authorization: `Bearer ${server!.endpoint.token}`,
          "X-Secretary-API-Version": "1",
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    assert.equal(recheck.status, 200);
    const unchangedBytes = Buffer.from(await recheck.arrayBuffer());
    assert(unchangedBytes.equals(firstOutputs.get("first.json")!));
    assert.equal(unchangedMeta.execution_id, first.id);
    assert.equal(
      unchangedMeta.content_version,
      sha(firstOutputs.get("first.json")!),
    );
    write("first-artifact-immutability.json", {
      http_status: recheck.status,
      sha256: sha(unchangedBytes),
      unchanged: true,
      artifact_id: firstArtifact.artifact_id,
      producing_execution: first.id,
    });
    assert.deepEqual(
      fs
        .readdirSync(path.join(app!.store.dir, "workspaces", taskID, "work"))
        .sort(),
      ["first.json", "second.json", "stage1.py", "stage2.py"],
    );
    checks.push(
      "first API artifact immutable after continuation; no unexpected workspace files",
    );
    const oracleDir = path.join(directory, "host-oracle");
    fs.mkdirSync(oracleDir, { mode: 0o700 });
    fs.writeFileSync(
      path.join(oracleDir, "stage1.py"),
      firstOutputs.get("stage1.py")!,
      { mode: 0o600 },
    );
    const reproducedFirst = runApprovedProgram(oracleDir, "stage1.py");
    assert(reproducedFirst.equals(firstOutputs.get("first.json")!));
    const oracleSecond = path.join(directory, "host-oracle-second");
    fs.mkdirSync(oracleSecond, { mode: 0o700 });
    fs.writeFileSync(
      path.join(oracleSecond, "first.json"),
      firstOutputs.get("first.json")!,
      { mode: 0o600 },
    );
    fs.writeFileSync(
      path.join(oracleSecond, "stage2.py"),
      secondOutputs.get("stage2.py")!,
      { mode: 0o600 },
    );
    const reproducedSecond = runApprovedProgram(oracleSecond, "stage2.py");
    assert(reproducedSecond.equals(secondOutputs.get("second.json")!));
    bytesOracle(reproducedFirst, reproducedSecond);
    checks.push(
      "host independently reexecuted API-downloaded programs using API-downloaded first output, byte-for-byte match",
    );
    assert.equal(approvals.length, 4);
    assert.equal(app!.store.all("Operation").length, 4);
    assert.equal(downloads.length, 4);
    assert(
      calls.every(
        (call) => call.provider === provider && call.model === modelID,
      ),
    );
    assert(
      attempts.length <= LIMITS.attempts &&
        Date.now() - started < LIMITS.total_ms,
    );
    pass = true;
  } catch (error) {
    failure = {
      phase,
      message: clean(error),
      cause_code:
        (error as Error & { cause?: { code?: string } }).cause?.code ?? null,
    };
    process.exitCode = 1;
  } finally {
    if (app)
      write("durable-final.json", {
        executions: app.store.all("Execution"),
        tasks: app.store.all("TaskPlan"),
        results: app.store.all("TaskResult"),
        operations: app.store.all("Operation"),
        authorizations: app.store.all<AuthorizationRequest>(
          "AuthorizationRequest",
        ),
        model_calls: app.store.all("ModelCall"),
      });
    try {
      await server?.close();
      if (app && !server) await app.close();
    } catch (error) {
      failure ??= { phase, message: clean(error) };
      pass = false;
      process.exitCode = 1;
    }
    clearTimeout(watchdog);
    globalThis.fetch = originalFetch;
    persist();
    write("downloads.json", downloads);
    const report = {
      evidence: "REAL_MODEL_TOOLS_API_ARTIFACT_BYTES",
      pass,
      state: pass ? "completed" : "failed",
      limits: {
        ...LIMITS,
        minimum_provider_start_interval_ms: MIN_PROVIDER_START_INTERVAL_MS,
      },
      actual_attempts: attempts.length,
      elapsed_ms: Date.now() - started,
      provider: process.env.SECRETARY_TASK_PROVIDER,
      model: process.env.SECRETARY_TASK_MODEL,
      checks,
      failure,
      usage: metrics(),
      billing_cost: "unavailable",
      approvals: approvals.length,
      downloads,
      tool_counts: Object.fromEntries(
        ["read", "write", "bash", "submit_result"].map((name) => [
          name,
          toolCalls.filter((call) => call.name === name).length,
        ]),
      ),
      limitations: [
        "Synthetic exact-program allowlist; not a general-purpose coding or shell-safety benchmark.",
        "Main feedback consumption and memory are outside this focused artifact scenario.",
        "Product verified_by remains NOT_VERIFIED; host byte oracle is independent evidence.",
        "Shell-generated output producing_operation_id may be null; provenance uses scoped shell receipt/stdout plus API hashes.",
        "Catalog cost is not actual billing.",
      ],
    };
    write("report.json", report);
    console.log(
      JSON.stringify({
        pass,
        actual_attempts: attempts.length,
        checks,
        failure,
        usage: metrics(),
        report: path.join(directory, "report.json"),
      }),
    );
  }
}
