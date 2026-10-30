/** Explicit, bounded issue #91 native/real-provider acceptance. Never run by npm test. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import { StdinBuffer } from "@earendil-works/pi-tui";
import { getModel } from "@earendil-works/pi-ai/compat";
import { App } from "../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../src/pi_secretary/src/api-v1.ts";
import { CoreClient } from "../../src/pi_secretary/src/core-client.ts";
import {
  roleModel,
  type ModelConfig,
} from "../../src/pi_secretary/src/model.ts";
import { TerminalApp } from "../../src/pi_secretary/src/tui/app.ts";
import { VirtualTerminal } from "../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import { until } from "../offline/issue9/helpers.ts";
import type { Input } from "../../src/pi_secretary/src/contracts.ts";

const [mode, target] = process.argv.slice(2);
if (
  !target ||
  !["--serve", "--resume", "--native", "--pty", "--replay"].includes(mode)
)
  throw Error(
    "Usage: test-issue91-live.ts --serve|--native|--pty|--replay <isolated-directory>",
  );
const root = path.resolve(target),
  coreDir = path.join(root, "core");
await fs.mkdir(root, { recursive: true, mode: 0o700 });
const writes = new Map<string, Promise<void>>();
const write = (name: string, value: unknown) => {
  const bytes = JSON.stringify(value, null, 2),
    output = path.join(root, name);
  const job = (writes.get(name) ?? Promise.resolve()).then(async () => {
    await fs.writeFile(output + ".tmp", bytes, { mode: 0o600 });
    await fs.rename(output + ".tmp", output);
  });
  writes.set(name, job);
  return job;
};
const limits = {
  attempts: 12,
  total_ms: 900000,
  request_ms: 90000,
  output_tokens: 4096,
};

if (mode === "--serve" || mode === "--resume") {
  if (mode === "--serve")
    await fs.access(path.join(coreDir, "core-endpoint.json")).then(
      () => {
        throw Error("FRESH_ISOLATED_DIRECTORY_REQUIRED");
      },
      () => {},
    );
  const credentials = JSON.parse(
    await fs.readFile(path.resolve(".demo-data/live-credentials.json"), "utf8"),
  );
  const model = getModel("opencode-go", "deepseek-v4.1-flash");
  if (!model) throw Error("CONFIGURED_MODEL_NOT_FOUND");
  const real = roleModel(model, credentials.main, "main"),
    scope = new AsyncLocalStorage<number>();
  const previous =
    mode === "--resume"
      ? JSON.parse(
          await fs.readFile(path.join(root, "provider-ledger.json"), "utf8"),
        )
      : { calls: [], attempts: [], posts: [], started_at: null };
  if (
    previous.calls.some(
      (call: Record<string, unknown>) => !call.finished_at && !call.error,
    )
  )
    throw Error("UNCERTAIN_INFLIGHT_LIVE_CALL_REQUIRES_AUDIT");
  const calls: Array<Record<string, unknown>> = previous.calls,
    attempts: Array<Record<string, unknown>> = previous.attempts,
    posts: Array<Record<string, unknown>> = previous.posts;
  let started: number | undefined = previous.started_at
    ? Date.parse(previous.started_at)
    : undefined;
  const ledger = () =>
    write("provider-ledger.json", {
      limits,
      started_at: started ? new Date(started).toISOString() : null,
      calls,
      attempts,
      posts,
    });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== new URL(model.baseUrl).hostname)
      return originalFetch(input, init);
    started ??= Date.now();
    if (
      attempts.length >= limits.attempts ||
      Date.now() - started > limits.total_ms
    )
      throw Error("ISSUE91_LIVE_BUDGET_EXHAUSTED");
    const number = attempts.length + 1;
    const attempt: Record<string, unknown> = {
      number,
      call: scope.getStore(),
      started_at: new Date().toISOString(),
      host: url.hostname,
    };
    attempts.push(attempt);
    // Synthetic test context only; never retain request headers or credentials.
    const body =
      typeof init?.body === "string"
        ? init.body
        : input instanceof Request
          ? await input.clone().text()
          : "";
    await write(`provider-request-${number}.json`, JSON.parse(body || "null"));
    await ledger();
    try {
      const result = await originalFetch(input, init);
      attempt.status = result.status;
      await ledger();
      return result;
    } catch (e) {
      attempt.error = String(e);
      await ledger();
      throw e;
    }
  }) as typeof fetch;
  const config: ModelConfig = {
    model,
    stream: (m, context, options) => {
      const out = createAssistantMessageEventStream(),
        number = calls.length + 1;
      const entry: Record<string, unknown> = {
        number,
        model: model.id,
        started_at: new Date().toISOString(),
      };
      calls.push(entry);
      void scope.run(number, async () => {
        try {
          const signals = [
            AbortSignal.timeout(limits.request_ms),
            ...(options?.signal ? [options.signal] : []),
          ];
          const stream = await real.stream!(m, context, {
            ...options,
            maxTokens: Math.min(
              options?.maxTokens ?? limits.output_tokens,
              limits.output_tokens,
            ),
            signal: AbortSignal.any(signals),
          });
          let first = true;
          for await (const event of stream) {
            if (first) {
              entry.first_event_at = new Date().toISOString();
              first = false;
            }
            out.push(event); // Actual streaming, never buffer the answer before exposing it.
          }
          const result = await stream.result();
          entry.finished_at = new Date().toISOString();
          entry.stop_reason = result.stopReason;
          entry.usage = result.usage;
          await write(`provider-response-${number}.json`, result);
          out.end(result);
        } catch (error) {
          entry.error = String(error);
          const failure: AssistantMessage = {
            role: "assistant",
            content: [],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
            stopReason: "error",
            errorMessage: String(error),
            timestamp: Date.now(),
          };
          out.push({ type: "error", reason: "error", error: failure });
          out.end(failure);
        } finally {
          await ledger();
        }
      });
      return out;
    },
  };
  const app = await App.open(coreDir, { main: config, task: config });
  // UI navigation fixtures are synthetic; only subsequent five Master inputs incur model calls.
  const fixtures = [];
  for (let index = 1; mode === "--serve" && index <= 35; index++)
    fixtures.push(
      app.store.event(
        "main.message",
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: `History fixture ${index}\n\nSynthetic navigation row ${index}. 中文阅读锚点，不含个人资料。\n\n${"Stable reading line. ".repeat(8)}`,
            },
          ],
          stopReason: "stop",
        },
        { session_id: app.host.sessionID, task_id: null, execution_id: null },
      ),
    );
  app.store.commit([], fixtures);
  const server = await serveCore(app, 0);
  const command = server.service.command.bind(server.service);
  server.service.command = (principal, route, body) => {
    const receipt = command(principal, route, body);
    if (route === "messages") {
      const b = body as { request_id: string; text: string };
      posts.push({
        request_id: b.request_id,
        text: b.text,
        sha256: createHash("sha256").update(b.text).digest("hex"),
        acceptance: receipt.acceptance,
        at: new Date().toISOString(),
      });
      void ledger();
    }
    return receipt;
  };
  await write("ready.json", { pid: process.pid, model: model.id, limits });
  await fs.writeFile(
    path.join(coreDir, "core-endpoint.json"),
    JSON.stringify(server.endpoint),
    { mode: 0o600 },
  );
  const collect = async () => {
    const inputs = app.store
      .all<Input>("Input")
      .filter((x) => x.producer === "MASTER")
      .map((x) => ({
        id: x.id,
        dedupe_key: x.dedupe_key,
        state: x.state,
        payload: { text: app.store.bytes(x.payload).toString("utf8") },
      }));
    await write("core-inputs.json", inputs);
  };
  const timer = setInterval(() => void collect(), 250);
  const close = async () => {
    clearInterval(timer);
    await server.close();
    await collect();
    await ledger();
    await app.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
  console.log(
    "Issue91 isolated live Core ready; bounded provider ledger enabled.",
  );
} else if (mode === "--native" || mode === "--pty") {
  const app = new TerminalApp(
    coreDir,
    undefined,
    path.join(root, "native-state"),
  );
  await write("terminal-driver.json", {
    mode,
    driver: "ProcessTerminal",
    native_clipboard:
      mode === "--pty"
        ? "NOT_TESTED: CUA denied com.apple.Terminal"
        : "manual acceptance required",
  });
  const snapshots: unknown[] = [];
  let previous = "";
  const timer = setInterval(() => {
    const value = {
      page: app.page,
      viewing: app.viewing,
      anchor: app.documents.Main.anchor,
      top: app.scrolls.Main.scrollTop,
      atEnd: app.scrolls.Main.atEnd,
      cot: app.remote?.history.thinking,
      pending: app.delivery?.state.pending?.status,
      draft: app.editors[app.page].getExpandedText(),
      ids: [...(app.remote?.history.items.keys() ?? [])],
      revisions: [...(app.remote?.history.items.values() ?? [])].map(
        (item) => ({
          id: item.id,
          revision: item.revision,
          length: item.kind === "message" ? item.text.length : 0,
        }),
      ),
      footer: app.footer.render(100),
    };
    const serial = JSON.stringify(value);
    if (serial !== previous) {
      previous = serial;
      snapshots.push({ at: new Date().toISOString(), ...value });
      void write("native-snapshots.json", snapshots);
    }
  }, 100);
  const close = app.close.bind(app);
  app.close = async () => {
    clearInterval(timer);
    await close();
    await write("native-snapshots.json", snapshots);
  };
  app.start();
  process.once("SIGTERM", () => void app.close());
} else {
  const terminal = new VirtualTerminal(100, 30),
    app = new TerminalApp(coreDir, terminal, path.join(root, "replay-state"));
  app.start();
  await until(
    () =>
      !!app.delivery && app.editors.Main.enabled && !!app.remote?.timelineReady,
    10000,
  );
  const client = app.delivery!.client!,
    originalCommand = client.command.bind(client),
    originalQuery = client.query.bind(client);
  const events: unknown[] = [];
  let posts = 0,
    statusBlocked = true;
  client.command = async (route, body) => {
    const receipt = await originalCommand(route, body);
    posts++;
    events.push({
      type: "post-reached-core",
      id: body.request_id,
      acceptance: receipt.acceptance,
      at: new Date().toISOString(),
    });
    if (posts === 1) throw Error("INJECTED_ACCEPTED_RECEIPT_LOSS");
    statusBlocked = false;
    return receipt;
  };
  client.query = async <T>(
    route: string,
    options?: Parameters<CoreClient["query"]>[1],
  ): Promise<T> => {
    if (route.startsWith("requests/") && statusBlocked) {
      events.push({
        type: "status-transport-loss",
        at: new Date().toISOString(),
      });
      throw Error("INJECTED_STATUS_TRANSPORT_LOSS");
    }
    return originalQuery<T>(route, options);
  };
  const stdin = new StdinBuffer();
  stdin.on("data", (data) => terminal.sendInput(data));
  stdin.on("paste", (data) =>
    terminal.sendInput("\x1b[200~" + data + "\x1b[201~"),
  );
  const originalLedger = JSON.parse(
    await fs.readFile(path.join(root, "provider-ledger.json"), "utf8"),
  );
  try {
    stdin.process(
      "L4-ISSUE91-REPLAY. Reply exactly REPLAY-OK. Do not use tools.",
    );
    stdin.process("\x1b[13;2u");
    await until(
      () =>
        posts === 1 &&
        !app.delivery!.busy &&
        app.delivery!.state.pending?.status === "UNKNOWN",
      10000,
    );
    const first = app.delivery!.state.pending!;
    // Quiescence is observed from the real provider ledger, not inferred from receipt acceptance.
    const deadline = Date.now() + 100000;
    while (true) {
      const ledger = JSON.parse(
        await fs.readFile(path.join(root, "provider-ledger.json"), "utf8"),
      );
      const inputs = JSON.parse(
        await fs.readFile(path.join(root, "core-inputs.json"), "utf8"),
      );
      if (
        ledger.calls.length > originalLedger.calls.length &&
        ledger.calls.every(
          (x: Record<string, unknown>) => x.finished_at || x.error,
        ) &&
        inputs.some(
          (x: { payload: { text?: string }; state: string }) =>
            x.payload?.text === first.body.text && x.state === "HANDLED",
        )
      )
        break;
      if (Date.now() > deadline) throw Error("LIVE_MODEL_QUIESCENCE_TIMEOUT");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const before = JSON.parse(
      await fs.readFile(path.join(root, "provider-ledger.json"), "utf8"),
    );
    stdin.process("\x1b[13;2u");
    await until(
      () => posts === 2 && !app.delivery!.busy && !app.delivery!.state.pending,
      10000,
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const after = JSON.parse(
      await fs.readFile(path.join(root, "provider-ledger.json"), "utf8"),
    );
    const inputs = JSON.parse(
      await fs.readFile(path.join(root, "core-inputs.json"), "utf8"),
    );
    const matches = inputs.filter(
      (x: { payload: { text?: string } }) =>
        x.payload?.text === first.body.text,
    );
    assert.equal(after.attempts.length, before.attempts.length);
    assert.equal(matches.length, 1);
    const matchingPosts = after.posts.filter(
      (x: { request_id: string }) => x.request_id === first.id,
    );
    assert.equal(matchingPosts.length, 2);
    assert.equal(matchingPosts[0].text, matchingPosts[1].text);
    await write("replay-result.json", {
      status: "PASS",
      driver:
        "TerminalApp + Pi VirtualTerminal/StdinBuffer + real Core/provider",
      events,
      request_id: first.id,
      input_count: matches.length,
      attempts_before: before.attempts.length,
      attempts_after: after.attempts.length,
      screen: await terminal.flushAndGetViewport(),
    });
  } finally {
    stdin.destroy();
    await app.close();
  }
}
