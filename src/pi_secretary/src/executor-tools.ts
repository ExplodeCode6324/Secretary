import * as fs from "node:fs";
import { Type } from "typebox";
import { BACKGROUND_CONTEXT } from "../../pi_resource/packages/agent/src/harness/context.ts";
import { NodeExecutionEnv } from "../../pi_resource/packages/agent/src/harness/env/nodejs.ts";
import { createReadTool } from "../../pi_resource/packages/agent/src/harness/tools/read.ts";
import { createWriteTool } from "../../pi_resource/packages/agent/src/harness/tools/write.ts";
import { activitiesFor } from "./activity.ts";
import type {
  DecisionRequest,
  Execution,
  Operation,
  TaskPlan,
} from "./contracts.ts";
import { scopeOf, stableID } from "./execution-utils.ts";
import { invocation } from "./executor-invocation.ts";
import { tool, type AgentTool } from "./model.ts";
import type { SchedulerContext } from "./scheduler-context.ts";
import { base, hash, revise } from "./store.ts";
const jsonTool = (value: unknown, terminate = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  details: undefined,
  terminate,
});

type ExecutorToolsContext = Pick<
  SchedulerContext,
  | "applyShell"
  | "applyWrite"
  | "auth"
  | "feedback"
  | "fileRevision"
  | "finish"
  | "proposalFor"
  | "rootFor"
  | "running"
  | "safePath"
  | "setState"
  | "store"
>;

export function tools(this: ExecutorToolsContext, e: Execution): AgentTool[] {
  const upstreamRead = createReadTool(),
    upstreamWrite = createWriteTool();
  const tools: AgentTool[] = [
    tool({
      name: "submit_result",
      label: "Submit structured task result",
      description:
        "Finish task with assessments for every C1..Cn criterion, evidence, limitations and existing workspace artifact paths. Does not independently verify semantic correctness.",
      parameters: Type.Object({
        outcome: Type.Union([
          Type.Literal("SUCCEEDED"),
          Type.Literal("FAILED"),
        ]),
        summary: Type.String({ minLength: 1 }),
        criteria: Type.Array(
          Type.Object({
            id: Type.String(),
            met: Type.Boolean(),
            evidence: Type.String({ minLength: 1 }),
          }),
        ),
        artifacts: Type.Array(Type.String()),
        limitations: Type.Array(Type.String()),
      }),
      execute: async (_call, args) => {
        const plan = this.store.get<TaskPlan>("TaskPlan", e.task_id);
        const proposal = this.proposalFor(e);
        const expected = proposal.acceptance_criteria.map(
          (_, i) => `C${i + 1}`,
        );
        if (
          args.criteria.length !== expected.length ||
          new Set(args.criteria.map((c) => c.id)).size !== expected.length ||
          expected.some((id) => !args.criteria.some((c) => c.id === id))
        )
          throw Error("INCOMPLETE_ACCEPTANCE_ASSESSMENT");
        if (args.outcome === "SUCCEEDED" && args.criteria.some((c) => !c.met))
          throw Error("UNMET_ACCEPTANCE_CRITERION");
        const effects = this.store
          .all<Operation>("Operation")
          .filter((o) => o.scope.execution_id === e.id);
        if (
          effects.some((o) =>
            ["WAIT_AUTH", "DISPATCHED", "RESULT_UNKNOWN"].includes(o.state),
          )
        )
          throw Error("UNRESOLVED_OPERATION");
        const artifacts = args.artifacts.map((relative) => {
          const target = this.safePath(e, relative);
          if (!fs.statSync(target).isFile()) throw Error("ARTIFACT_NOT_FILE");
          return {
            path: relative,
            content: this.store.put(
              fs.readFileSync(target),
              "application/octet-stream",
            ),
          };
        });
        this.finish(e.id, args.outcome, {
          structured_result: args,
          artifacts,
        });
        return jsonTool(
          { saved: true, outcome: args.outcome, verified_by: "NOT_VERIFIED" },
          true,
        );
      },
    }),
    tool({
      name: "read",
      label: "Read workspace",
      description: upstreamRead.description,
      parameters: upstreamRead.parameters,
      execute: async (call, args) => {
        const target = this.safePath(e, args.path);
        return upstreamRead.execute(
          call,
          { ...args, path: target },
          () => {},
          {
            env: new NodeExecutionEnv({
              cwd: this.rootFor(e),
            }),
          },
          invocation(call),
          BACKGROUND_CONTEXT,
        );
      },
    }),
    tool({
      name: "write",
      label: "Write in execution workspace",
      description:
        upstreamWrite.description +
        " Workspace policy or an existing rule may authorize writes; otherwise wait for Master approval. Never retry an unknown effect.",
      parameters: upstreamWrite.parameters,
      execute: async (_call, args) => {
        const resource = this.safePath(e, args.path);
        const intent = stableID(e.id + ":write:" + JSON.stringify(args));
        const op = this.auth.prepare(
          scopeOf(e),
          "file.write",
          resource,
          args,
          intent,
          this.fileRevision(resource),
        );
        if (op.state === "SUCCEEDED")
          return jsonTool({ operation_id: op.id, state: op.state });
        if (op.state === "RESULT_UNKNOWN") {
          this.setState(e.id, "RESULT_UNKNOWN", {
            unknown_operation_ids: [op.id],
          });
          return jsonTool({ state: "RESULT_UNKNOWN" }, true);
        }
        if (op.state !== "AUTHORIZED") {
          if (op.state !== "WAIT_AUTH" || !op.authorization_id)
            return jsonTool(
              {
                operation_id: op.id,
                state: op.state,
                error: op.error ?? "WRITE_NOT_DISPATCHABLE",
              },
              true,
            );
          this.setState(e.id, "WAIT_AUTH", {
            waiting_request_ids: op.authorization_id
              ? [op.authorization_id]
              : [],
          });
          return jsonTool({ operation_id: op.id, state: op.state }, true);
        }
        return jsonTool(await this.applyWrite(op));
      },
    }),
    tool({
      name: "bash",
      label: "Run shell command with approval",
      description:
        "Execute a real bash command as the local user, starting in the task workspace. Supports system inspection, files and network; not sandboxed. Simple readonly commands or an existing rule may run automatically; otherwise wait for Master approval. Returns durable stdout, stderr and exit_code receipts. Never repeat an unknown effect.",
      parameters: Type.Object({
        command: Type.String({ minLength: 1 }),
        timeout: Type.Optional(Type.Number({ minimum: 0.1, maximum: 3600 })),
      }),
      execute: async (call, args) => {
        const cwd = this.rootFor(e);
        const op = this.auth.prepare(
          scopeOf(e),
          "shell.run",
          cwd,
          this.auth.shellParameters(
            scopeOf(e),
            args.command,
            args.timeout ?? 120,
            cwd,
            stableID(e.id + ":bash:" + call),
          ),
          stableID(e.id + ":bash:" + call),
        );
        if (op.receipt) return jsonTool(this.store.read(op.receipt));
        if (op.state !== "AUTHORIZED") {
          if (op.state !== "WAIT_AUTH") throw Error("SHELL_NOT_DISPATCHABLE");
          this.setState(e.id, "WAIT_AUTH", {
            waiting_request_ids: [op.authorization_id!],
          });
          return jsonTool({ operation_id: op.id, state: op.state }, true);
        }
        const result = await this.applyShell(op, this.running.get(e.id)!);
        return jsonTool(
          result,
          this.store.get<Execution>("Execution", e.id).state ===
            "RESULT_UNKNOWN",
        );
      },
    }),
    tool({
      name: "request_decision",
      label: "Ask for work decision",
      description:
        "Ask an ordinary work decision. Does not request or grant authorization.",
      parameters: Type.Object({ question: Type.String() }),
      execute: async (_call, args) => {
        const d: DecisionRequest = {
          schema_version: 1,
          record_type: "DecisionRequest",
          ...base(),
          state: "OPEN",
          task_id: e.task_id,
          execution_id: e.id,
          question: args.question,
          options: [],
          impact: "Execution paused",
          materials: [],
          deadline: null,
          answer: null,
          answered_by: null,
          answer_request_id: null,
        };
        const current = this.store.get<Execution>("Execution", e.id);
        this.store.commit(
          [
            d,
            revise(current, {
              state: "WAIT_DECISION",
              waiting_request_ids: [d.id],
            }),
          ],
          [this.store.event("decision.requested", d, scopeOf(e))],
        );
        this.feedback(
          e.id,
          "DECISION_REQUIRED",
          args.question,
          this.store.put(d),
          null,
          d.id,
        );
        return jsonTool({ decision_id: d.id, state: "WAIT_DECISION" }, true);
      },
    }),
  ];
  return tools.map((t) => ({
    ...t,
    execute: async (call, args, signal, update) => {
      const current = this.store.get<Execution>("Execution", e.id);
      if (current.state !== "RUNNING" || current.cancel_requested)
        return jsonTool({ state: current.state, blocked: true }, true);
      const key = `${e.id}:${call}:${t.name}:${hash(JSON.stringify(args))}`;
      const prior = this.store.logs.find(
        (l) =>
          l.event_type === "executor.tool.result" &&
          l.scope.execution_id === e.id &&
          this.store.read<{ key: string }>(l.payload).key === key,
      );
      if (prior)
        return this.store.read<{
          result: Awaited<ReturnType<typeof t.execute>>;
        }>(prior.payload).result;
      const value = await activitiesFor(this.store).tool(
        "tool:" + e.id + ":" + call,
        scopeOf(e),
        t.name,
        args,
        () => t.execute(call, args, signal, update),
      );
      this.store.commit(
        [],
        [
          this.store.event(
            "executor.tool.result",
            { key, result: value },
            scopeOf(e),
            "EXECUTOR",
          ),
        ],
      );
      return value;
    },
  }));
}
