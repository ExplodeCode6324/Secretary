// Infrastructure-only entry. Real model workloads/credentials are deliberately deferred to #121.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../../src/pi_secretary/src/api-v1.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import type {
  Execution,
  Operation,
  PushDispatch,
} from "../../../src/pi_secretary/src/contracts.ts";
import { appendJSON, readJSON, requireThat, writeJSON } from "./io.ts";
import { validateConfiguration, type WorkerPermit } from "./domain.ts";

process.umask(0o077);
let permitted = false;
process.once("disconnect", () => {
  if (!permitted) process.exit(2);
});
process.once("message", async (message: { permit: WorkerPermit }) => {
  const run = message.permit;
  try {
    requireThat(
      process.argv[2] === "--run" && process.argv[3] === run.id,
      "WORKER_RUN_MISMATCH",
    );
    const marker = readJSON(path.join(run.active, "marker.json"));
    requireThat(
      marker.id === run.id && marker.nonce === run.nonce,
      "WORKER_MARKER_MISMATCH",
    );
    validateConfiguration(run.config);
    permitted = true;
    // No ambient product/provider configuration, regardless of the caller's shell.
    requireThat(
      !Object.keys(process.env).some(
        (k) =>
          k.startsWith("SECRETARY_") ||
          k.startsWith("PG") ||
          k === "NODE_OPTIONS",
      ),
      "AMBIENT_CONFIGURATION",
    );
    // Fixture mode has no provider/network workload; any fetch is a test defect.
    globalThis.fetch = async (input) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      appendJSON(path.join(run.evidence, "unexpected-network.jsonl"), {
        origin: url.origin,
      });
      throw Error("FIXTURE_NETWORK_FORBIDDEN");
    };
    writeJSON(path.join(run.evidence, "worker-configuration.json"), run.config);
    let calls = 0,
      app: App;
    const stream: StreamFn = (m, c, o) => {
      appendJSON(path.join(run.evidence, "fixture-calls.jsonl"), {
        number: ++calls,
        at: new Date().toISOString(),
        pid: process.pid,
        evidence: "SCRIPTED_PROTOCOL",
        physical_provider_sends: 0,
        context: c,
      });
      const task = c.messages.some(
        (x) =>
          x.role === "system" && JSON.stringify(x).includes("TASK_EXECUTOR"),
      );
      if (!task) {
        const last = c.messages.at(-1);
        if (
          last?.role === "user" &&
          JSON.stringify(last).includes("BENCHMARK_NOTIFY")
        )
          return replyStream(
            [
              {
                type: "toolCall",
                id: randomUUID(),
                name: "MasterInteract",
                arguments: { message: "Private infrastructure sink" },
              },
            ],
            m,
          );
        return fixtureStream(m, c, o);
      }
      const packetIndex = c.messages.findLastIndex(
        (x) =>
          x.role === "user" &&
          JSON.stringify(x).includes("secretary.agent-task.v1"),
      );
      const packet = JSON.stringify(c.messages[packetIndex]);
      const results = c.messages
        .slice(packetIndex + 1)
        .filter((x) => x.role === "toolResult");
      const tool = (name: string, args: Record<string, any>) =>
        replyStream(
          [{ type: "toolCall", id: randomUUID(), name, arguments: args }],
          m,
        );
      const continued = packet.includes("BENCHMARK_CONTINUE");
      const escape = packet.includes("BENCHMARK_ESCAPE");
      if (!results.length && (continued || escape))
        return tool("read", {
          path: escape
            ? packet.includes("ABSOLUTE")
              ? path.join(run.evidence, "controller-oracle")
              : packet.includes("SYMLINK")
                ? "oracle-link"
                : "../controller-oracle"
            : "continuity.txt",
        });
      if (continued && results.length === 1)
        requireThat(
          JSON.stringify(results[0]).includes("alpha"),
          "CONTINUATION_READ_FAILED",
        );
      if (!escape && results.length < (continued ? 2 : 1))
        return tool("write", {
          path: "continuity.txt",
          content: packet.includes("BENCHMARK_INTERRUPTED_WRITE")
            ? "uncertain"
            : continued
              ? "beta"
              : "alpha",
        });
      return tool("submit_result", {
        outcome: escape ? "FAILED" : "SUCCEEDED",
        summary: escape ? "Expected path refusal" : "Fixture write completed",
        criteria: [{ id: "C1", met: !escape, evidence: "Actual tool receipt" }],
        artifacts: escape ? [] : ["continuity.txt"],
        artifact_descriptions: escape
          ? []
          : [
              {
                path: "continuity.txt",
                description: "Infrastructure continuity artifact",
              },
            ],
        limitations: ["Scripted protocol only; no memory quality claim"],
      });
    };
    app = await App.open(
      path.join(run.active, "core"),
      { model: fixtureModel, stream },
      run.core_dsn,
      {
        pushDelivery: async (_directory, target, _message, _signal) => {
          requireThat(
            target.kind === "MACOS_NOTIFICATION" && target.endpoint === null,
            "UNSAFE_PUSH_DELIVERY",
          );
          const dispatches = app.store
            .all<PushDispatch>("PushDispatch")
            .filter((d) => d.target_id === target.id && d.state === "SENDING")
            .map((d) => ({
              id: d.id,
              batch: d.batch_id,
              attempt: d.attempt_history.at(-1)?.id,
            }));
          requireThat(
            dispatches.length > 0 && dispatches.every((d) => d.attempt),
            "AMBIGUOUS_SINK_ASSOCIATION",
          );
          appendJSON(path.join(run.evidence, "sink.jsonl"), {
            call_id: randomUUID(),
            at: new Date().toISOString(),
            dispatches,
          });
        },
      },
    );
    // Fixture-only crash barrier: real write and fsync have completed, durable result has not.
    const finish = app.authorization.finish.bind(app.authorization);
    app.authorization.finish = ((id, receipt, outcome) => {
      const operation = app.store.get<Operation>("Operation", id);
      if (
        run.config.fault_injection === "write-after-fsync" &&
        operation.action.action === "file.write" &&
        operation.state === "DISPATCHED" &&
        app.store.read<any>(operation.action.parameters_ref).content ===
          "uncertain"
      ) {
        appendJSON(path.join(run.evidence, "write-barrier.jsonl"), {
          operation_id: id,
          resource: operation.action.resource,
          pid: process.pid,
        });
        process.kill(process.pid, "SIGKILL");
      }
      return finish(id, receipt, outcome);
    }) as typeof app.authorization.finish;
    requireThat(app.world?.ready && app.world.configured, "WORLD_NOT_READY");
    const role = (
      await app.world.pool.query(
        "SELECT current_user AS name, rolsuper FROM pg_roles WHERE rolname = current_user",
      )
    ).rows[0];
    requireThat(
      role?.name === "benchmark_core" && role.rolsuper === false,
      "WORKER_DATABASE_PRIVILEGE",
    );
    writeJSON(path.join(run.evidence, "database-role.json"), role);
    let server: Awaited<ReturnType<typeof serveCore>>,
      stopping = false;
    const observe = () =>
      writeJSON(path.join(run.evidence, "observed.json"), {
        pid: process.pid,
        session_id: app.host.sessionID,
        sequence: app.store.sequence,
        inputs: app.store.all("Input").length,
        executions: app.store.all<Execution>("Execution"),
        operations: app.store.all("Operation"),
        pushes: app.store.all("PushDispatch"),
        tasks: app.store.all("TaskPlan"),
        model_calls: calls,
        rss: process.memoryUsage().rss,
      });
    const timer = setInterval(observe, 200);
    async function stop() {
      if (stopping) return;
      stopping = true;
      clearInterval(timer);
      try {
        await app.world?.memorySearch.catchUp();
        await server.close();
        observe();
        writeJSON(path.join(run.evidence, "exit.json"), {
          pid: process.pid,
          at: new Date().toISOString(),
          status: "CLOSED",
        });
        process.exit(0);
      } catch (e) {
        console.error(e);
        process.exit(1);
      }
    }
    server = await serveCore(app, 0, () => {
      setTimeout(() => void stop(), 10);
    });
    for (const s of ["SIGTERM", "SIGINT"] as const)
      process.on(s, () => void stop());
    observe();
    writeJSON(path.join(run.evidence, "ready.json"), {
      id: run.id,
      nonce: run.nonce,
      endpoint: server.endpoint,
      session_id: app.host.sessionID,
      at: new Date().toISOString(),
    });
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
});
