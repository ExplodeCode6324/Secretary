// Owned fixture/live entry. A detached sender owns its durable campaign accounting.
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
import { appendJSON, readJSON, requireThat, writeJSON, read } from "./io.ts";
import { completedFileWrite } from "./effect-proof.ts";
import { validateConfiguration, type WorkerPermit } from "./domain.ts";
import { configureProfile, liveRoles, meteredFetch } from "./live-model.ts";
import { capacityForecast } from "./capacity.ts";

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
    if (run.config.mode === "live") {
      requireThat(run.live?.key && run.live.facility, "LIVE_PERMIT_REQUIRED");
      configureProfile(run.config.profile);
      globalThis.fetch = meteredFetch({
        root: run.live.facility,
        run: run.id,
        episode: run.lineage,
        evidence: run.evidence,
        model: run.config.model,
        key: run.live.key,
        maxSends: run.config.max_sends,
      });
    } else
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
      run.config.mode === "live"
        ? liveRoles(run.config.model, run.live!.key, run.evidence)
        : { model: fixtureModel, stream },
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
    // Real write and fsync have completed; the durable result has not. Live targeting is path-based.
    writeJSON(
      path.join(run.evidence, "capacity-forecast.json"),
      capacityForecast(app),
    );
    const finish = app.authorization.finish.bind(app.authorization);
    app.authorization.finish = ((id, receipt, outcome) => {
      const operation = app.store.get<Operation>("Operation", id);
      const proof = receipt as any;
      // applyWrite's successful return includes both result and CAS evidence.
      // Its UNKNOWN error path also calls finish while DISPATCHED; it is not a
      // completed write. verifyWrite is RESULT_UNKNOWN and is reconciliation.
      const completedWrite = completedFileWrite(
        operation,
        receipt,
        outcome,
        () => read(operation.action.resource),
        () => app.store.bytes(proof.evidence),
      );
      if (completedWrite && run.config.mode === "live")
        appendJSON(path.join(run.evidence, "completed-file-writes.jsonl"), {
          at: new Date().toISOString(),
          operation_id: id,
          execution_id: operation.scope.execution_id,
          resource: operation.action.resource,
          content_sha256: proof.evidence.sha256,
          bytes: proof.evidence.bytes,
        });
      if (
        run.config.fault_injection === "write-after-fsync" &&
        completedWrite &&
        (run.config.mode === "fixture"
          ? app.store.read<any>(operation.action.parameters_ref).content ===
            "uncertain"
          : !!operation.scope.execution_id &&
            path.relative(
              app.store.get<Execution>(
                "Execution",
                operation.scope.execution_id,
              ).workspace_binding!.root_path,
              operation.action.resource,
            ) === run.config.fault_path &&
            !fs.existsSync(
              path.join(
                run.live!.facility,
                "campaign",
                `fault-${run.lineage}.json`,
              ),
            ))
      ) {
        if (run.config.mode === "live")
          writeJSON(
            path.join(
              run.live!.facility,
              "campaign",
              `fault-${run.lineage}.json`,
            ),
            {
              operation_id: id,
              run: run.id,
              at: new Date().toISOString(),
              resource: operation.action.resource,
            },
          );
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
        ...(run.config.mode === "live"
          ? {
              sessions: app.store.all("Session"),
              input_records: app.store.all("Input"),
              input_events: app.store
                .events("input.accepted")
                .map((event) => ({
                  event_id: event.event_id,
                  input_id: app.store.read<any>(event.payload).id,
                })),
              calls: app.store.all("ModelCall"),
              compactions: app.store.all("CompactionJob"),
              extractions: app.store.all("MemoryExtractionJob"),
              consciousness: app.store.all("Consciousness"),
              authorizations: app.store.all("AuthorizationRequest"),
              world_commands: app.store.all("WorldCommand"),
            }
          : {}),
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
