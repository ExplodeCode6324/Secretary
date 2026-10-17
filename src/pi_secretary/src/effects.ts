import { Ajv2020 } from "ajv/dist/2020.js";
import type { ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { BACKGROUND_CONTEXT } from "../../pi_resource/packages/agent/src/harness/context.ts";
import { NodeExecutionEnv } from "../../pi_resource/packages/agent/src/harness/env/nodejs.ts";
import { createWriteTool } from "../../pi_resource/packages/agent/src/harness/tools/write.ts";
import type { Execution, Operation, ProgramRegistration } from "./contracts.ts";
import { scopeOf, terminal } from "./execution-utils.ts";
import { invocation } from "./executor-invocation.ts";
import {
  inspectProcess,
  launchProcess,
  persistStop,
  requestStop,
} from "./process-control.ts";
import type { SchedulerContext } from "./scheduler-context.ts";
import { relativePath } from "./scopes.ts";
import { shellEnvironment, type ShellExecution } from "./shell-policy.ts";
import { base, hash, now } from "./store.ts";

type EffectsContext = Pick<
  SchedulerContext,
  | "auth"
  | "conditions"
  | "feedback"
  | "fileRevision"
  | "finish"
  | "rootFor"
  | "safePath"
  | "scopes"
  | "setState"
  | "settleUnknownExecution"
  | "stopChild"
  | "store"
  | "workspace"
>;

export function rootFor(this: EffectsContext, e: Execution) {
  return this.scopes.rootFor(e, path.join(this.workspace, e.task_id, "work"));
}

export function safePath(this: EffectsContext, e: Execution, relative: string) {
  return relativePath(this.rootFor(e), relative);
}

export async function applyShell(
  this: EffectsContext,
  op: Operation,
  entry: { child?: ChildProcess },
) {
  const eid = op.scope.execution_id!;
  const e = this.store.get<Execution>("Execution", eid);
  const params = this.store.read<{
    command: string;
    execution?: ShellExecution;
    timeout: number;
    cwd: string;
  }>(op.action.parameters_ref);
  const cwd = this.rootFor(e);
  this.safePath(e, ".shell-path-check");
  if (params.cwd !== cwd || op.action.resource !== cwd)
    throw Error("RESOURCE_CHANGED");
  if (this.conditions(e).some((c) => c.status !== "MET"))
    throw Error("PRECONDITION_CHANGED");
  this.auth.dispatch(op.id);
  let stdout = "",
    stderr = "",
    timed_out = false,
    truncated = false;
  const launched = await launchProcess(
    this.store,
    op.id,
    op.rule_id === "builtin:readonly-shell"
      ? params.execution!.argv
      : ["/bin/bash", "--noprofile", "--norc", "-c", params.command],
    cwd,
    op.rule_id === "builtin:readonly-shell"
      ? params.execution!.env
      : shellEnvironment(),
  );
  const child = launched.child;
  child.stdin!.end();
  entry.child = child;
  const limit = 4 * 1024 * 1024;
  const capture = (b: Buffer, stream: "stdout" | "stderr") => {
    const current = stream === "stdout" ? stdout : stderr;
    if (Buffer.byteLength(current) + b.length > limit) {
      truncated = true;
      this.stopChild(child);
    } else if (stream === "stdout") stdout += b.toString();
    else stderr += b.toString();
  };
  child.stdout!.on("data", (b) => capture(b, "stdout"));
  child.stderr!.on("data", (b) => capture(b, "stderr"));
  const timer = setTimeout(() => {
    timed_out = true;
    this.stopChild(child);
  }, params.timeout * 1000);
  try {
    if (this.store.get<Execution>("Execution", eid).cancel_requested)
      requestStop(child);
    else launched.start();
    const result = await launched.closed;
    persistStop(
      this.store,
      op.id,
      inspectProcess(this.store.get<Operation>("Operation", op.id).process!),
    );
    const receipt = {
      command: params.command,
      cwd,
      stdout,
      stderr,
      ...result,
      timed_out,
      truncated,
    };
    const unknown =
      !result.not_started &&
      (timed_out ||
        truncated ||
        result.signal !== null ||
        result.exit_code === null);
    this.auth.finish(
      op.id,
      receipt,
      result.not_started ? "NOT_APPLIED" : unknown ? "UNKNOWN" : "APPLIED",
    );
    if (unknown) {
      this.setState(eid, "RESULT_UNKNOWN", {
        unknown_operation_ids: [op.id],
      });
      this.feedback(
        eid,
        "UNKNOWN",
        "Shell interrupted; effects require verification, do not retry",
        this.store.put(receipt),
      );
    }
    return receipt;
  } finally {
    clearTimeout(timer);
    entry.child = undefined;
  }
}

export function fileRevision(this: EffectsContext, target: string): string {
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw Error("INVALID_RESOURCE");
    return hash(fs.readFileSync(target));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "ABSENT";
    throw error;
  }
}

export async function applyWrite(this: EffectsContext, op: Operation) {
  const e = this.store.get<Execution>("Execution", op.scope.execution_id!);
  if (e.cancel_requested || terminal(e)) throw Error("EXECUTION_NOT_ACTIVE");
  const params = this.store.read<{ path: string; content: string }>(
    op.action.parameters_ref,
  );
  const target = this.safePath(e, params.path);
  if (target !== op.action.resource) throw Error("RESOURCE_CHANGED");
  if (op.action.expected_resource_revision !== this.fileRevision(target))
    throw Error(
      "RESOURCE_REVISION_CHANGED: prepare a new operation and approval",
    );
  if (this.conditions(e).some((c) => c.status !== "MET"))
    throw Error("PRECONDITION_CHANGED");
  this.auth.dispatch(op.id);
  try {
    const tool = createWriteTool();
    const result = await tool.execute(
      op.id,
      { ...params, path: target },
      () => {},
      {
        env: new NodeExecutionEnv({
          cwd: this.rootFor(e),
        }),
      },
      invocation(op.id),
      BACKGROUND_CONTEXT,
    );
    const fd = fs.openSync(target, "r");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    const evidence = this.store.put(fs.readFileSync(target), "text/plain");
    return this.auth.finish(op.id, { result, evidence });
  } catch (error) {
    this.auth.finish(op.id, { error: String(error) }, "UNKNOWN");
    this.setState(e.id, "RESULT_UNKNOWN", { unknown_operation_ids: [op.id] });
    throw error;
  }
}

export function verifyWrite(this: EffectsContext, operationID: string) {
  const op = this.store.get<Operation>("Operation", operationID);
  if (
    op.state !== "RESULT_UNKNOWN" ||
    op.action.action !== "file.write" ||
    !op.scope.execution_id
  )
    throw Error("NO_VERIFIER_FOR_OPERATION");
  const e = this.store.get<Execution>("Execution", op.scope.execution_id);
  const params = this.store.read<{ path: string; content: string }>(
    op.action.parameters_ref,
  );
  const target = this.safePath(e, params.path);
  if (
    target !== op.action.resource ||
    !fs.existsSync(target) ||
    hash(fs.readFileSync(target)) !== hash(params.content)
  )
    return { verified: false, state: "RESULT_UNKNOWN" };
  const evidence = this.store.put(fs.readFileSync(target), "text/plain");
  this.auth.finish(
    op.id,
    {
      verified_postcondition: "Exact requested file content is present",
      evidence,
    },
    "APPLIED",
  );
  this.settleUnknownExecution(e.id);
  return { verified: true, evidence };
}

export function registerProgram(
  this: EffectsContext,
  entrypoint: string,
  name: string,
) {
  const absolute = path.resolve(entrypoint);
  const code = fs.readFileSync(absolute);
  const r: ProgramRegistration = {
    schema_version: 1,
    record_type: "ProgramRegistration",
    ...base(),
    state: "ENABLED",
    name,
    description:
      "Runs a manually reviewed Node script with the current user privileges; internal operations are authorized as a whole.",
    entrypoint: absolute,
    code_digest: hash(code),
    parameters_schema: this.store.put({
      type: "object",
      properties: { goal: { type: "string" } },
      required: ["goal"],
      additionalProperties: false,
    }),
    result_schema: this.store.put({
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
    }),
    preconditions: [],
    operation_kinds: ["program.run"],
    supports_resume: false,
    maintained_by: "HUMAN",
    validation_ref: this.store.put({
      entrypoint: absolute,
      code_digest: hash(code),
      confirmed_at: now(),
    }),
  };
  this.store.commit(
    [r],
    [this.store.event("program.registered", r, undefined, "MASTER_UI")],
  );
  return r;
}

export async function program(
  this: EffectsContext,
  eid: string,
  program: ProgramRegistration,
  params: unknown,
  opID: string,
  entry: { child?: ChildProcess },
) {
  const e = this.store.get<Execution>("Execution", eid);
  const validator = new Ajv2020();
  if (
    !validator.validate(
      this.store.read<object>(program.parameters_schema),
      params,
    )
  )
    throw Error("INVALID_PROGRAM_PARAMETERS");
  const launched = await launchProcess(
    this.store,
    opID,
    [process.execPath, program.entrypoint],
    this.rootFor(e),
    { PATH: process.env.PATH, LANG: "en_US.UTF-8" },
  );
  const child = launched.child;
  entry.child = child;
  let output = "",
    error = "";
  let overflow = false;
  child.stdout!.on("data", (b) => {
    this.store.commit(
      [],
      [
        this.store.event(
          "program.stdout",
          this.store.put(Buffer.from(b), "text/plain"),
          scopeOf(e),
          "PROGRAM",
        ),
      ],
    );
    if (output.length + b.length > 4 * 1024 * 1024) {
      overflow = true;
      this.stopChild(child);
    } else output += String(b);
  });
  child.stderr!.on("data", (b) => {
    this.store.commit(
      [],
      [
        this.store.event(
          "program.stderr",
          this.store.put(Buffer.from(b), "text/plain"),
          scopeOf(e),
          "PROGRAM",
        ),
      ],
    );
    if (error.length < 4 * 1024 * 1024) error += String(b);
  });
  child.stdin!.on("error", () => {});
  child.stdin!.end(JSON.stringify({ execution_id: eid, parameters: params }));
  if (this.store.get<Execution>("Execution", eid).cancel_requested)
    requestStop(child);
  else launched.start();
  const processResult = await launched.closed;
  const { exit_code: code } = processResult;
  persistStop(
    this.store,
    opID,
    inspectProcess(this.store.get<Operation>("Operation", opID).process!),
  );
  entry.child = undefined;
  if (processResult.not_started) {
    this.auth.finish(
      opID,
      { ...processResult, stdout: output, stderr: error },
      "NOT_APPLIED",
    );
    this.finish(eid, "CANCELLED", {
      reason: "Program cancelled before start",
    });
    return;
  }
  try {
    if (code !== 0 || overflow) throw Error("PROGRAM_EFFECT_UNCONFIRMED");
    const result = JSON.parse(output);
    if (
      !validator.validate(
        this.store.read<object>(program.result_schema),
        result,
      )
    )
      throw Error("INVALID_PROGRAM_RESULT");
    const outcome = result as { outcome?: string; effect?: string };
    if (
      outcome.outcome != null &&
      !["SUCCEEDED", "FAILED"].includes(outcome.outcome)
    )
      throw Error("UNSUPPORTED_PROGRAM_OUTCOME");
    this.auth.finish(
      opID,
      { result, stdout: output, stderr: error, code },
      outcome.effect === "NOT_APPLIED" ? "NOT_APPLIED" : "APPLIED",
    );
    this.finish(
      eid,
      outcome.outcome === "FAILED" ? "FAILED" : "SUCCEEDED",
      result,
    );
  } catch (err) {
    this.auth.finish(
      opID,
      { stdout: output, stderr: error, code, error: String(err) },
      "UNKNOWN",
    );
    this.setState(eid, "RESULT_UNKNOWN", { unknown_operation_ids: [opID] });
    this.feedback(
      eid,
      "UNKNOWN",
      "Program result unknown; no automatic retry",
      this.store.put({ stdout: output, stderr: error, code }),
    );
  }
}

export function stopChild(this: EffectsContext, child: ChildProcess) {
  requestStop(child);
}
