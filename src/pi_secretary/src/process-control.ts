import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Readable, Writable } from "node:stream";
import { Store, id, revise } from "./store.ts";
import type { Operation } from "./contracts.ts";

const runner = fileURLToPath(new URL("./process-runner.py", import.meta.url));
type Process = NonNullable<Operation["process"]>;
export type ProcessStatus = "RUNNING" | "STOPPED" | "UNCONFIRMED";
const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
export function inspectProcess(
  record: Process,
  signal?: "term" | "kill",
): ProcessStatus {
  if (record.state === "STOPPED" || record.state === "STARTING")
    return "STOPPED";
  if (!record.pid || !record.machine || !record.boot || !record.start)
    return "UNCONFIRMED";
  const result = spawnSync(
    "python3",
    [runner, signal ? "--" + signal : "--probe"],
    {
      input: JSON.stringify(record),
      encoding: "utf8",
      timeout: 5000,
    },
  );
  if (result.status !== 0) return "UNCONFIRMED";
  try {
    return JSON.parse(result.stdout).status as ProcessStatus;
  } catch {
    return "UNCONFIRMED";
  }
}
export async function stopProcess(record: Process): Promise<ProcessStatus> {
  let status = inspectProcess(record);
  for (const signal of ["term", "kill"] as const) {
    if (status !== "RUNNING") return status;
    status = inspectProcess(record, signal);
    if (status === "STOPPED") return status;
    const until = Date.now() + 2000;
    do {
      await wait(40);
      status = inspectProcess(record);
    } while (status !== "STOPPED" && Date.now() < until);
  }
  return status === "STOPPED" ? status : "UNCONFIRMED";
}
export function persistStop(
  store: Store,
  operationID: string,
  status: ProcessStatus,
) {
  const op = store.get<Operation>("Operation", operationID);
  if (!op.process || op.process.state === "STOPPED") return;
  store.commit([
    revise(op, {
      process: {
        ...op.process,
        state: status === "STOPPED" ? "STOPPED" : "UNCONFIRMED",
      },
    }),
  ]);
}
export function requestStop(child: ChildProcess) {
  const control = child.stdio[3] as Writable | null;
  if (control && !control.destroyed) control.write("STOP\n", () => {});
}
export async function launchProcess(
  store: Store,
  operationID: string,
  argv: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
) {
  const op = store.get<Operation>("Operation", operationID);
  if (op.process) throw Error("PROCESS_ALREADY_STARTED");
  const token = id();
  store.commit([revise(op, { process: { token, state: "STARTING" } })]);
  const child = spawn("python3", [runner, "--run", token], {
    cwd,
    env,
    detached: true,
    stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
  });
  const control = child.stdio[3] as Writable;
  control.on("error", () => {});
  child.stdin!.on("error", () => {});
  let outcome: { exit_code: number | null; signal: number | null } | undefined;
  let readyResolve: () => void, readyReject: (e: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  let prepared = false;
  const closed = new Promise<{
    exit_code: number | null;
    signal: number | string | null;
  }>((resolve, reject) => {
    child.once("error", (e) => {
      readyReject(e);
      reject(e);
    });
    child.once("close", (code, signal) => {
      if (!prepared) readyReject(Error("PROCESS_NOT_READY"));
      resolve(outcome ?? { exit_code: code, signal });
    });
  });
  // Install rejection handling before awaiting readiness.
  void closed.catch(() => {});
  let buffer = "";
  (child.stdio[4] as Readable)
    .setEncoding("utf8")
    .on("data", (data: string) => {
      buffer += data;
      while (buffer.includes("\n")) {
        const end = buffer.indexOf("\n"),
          line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          const message = JSON.parse(line);
          if (message.ready && !prepared) {
            const current = store.get<Operation>("Operation", operationID);
            store.commit([
              revise(current, {
                process: { ...message.ready, state: "RUNNING" },
              }),
            ]);
            prepared = true;
            // The caller installs output handlers before opening the gate.
            readyResolve();
          }
          if (message.result) outcome = message.result;
        } catch (e) {
          control.end();
          readyReject(e as Error);
        }
      }
    });
  const timer = setTimeout(() => {
    control.end();
    readyReject(Error("PROCESS_START_TIMEOUT"));
  }, 10000);
  try {
    await ready;
  } catch (error) {
    control.end();
    throw error;
  } finally {
    clearTimeout(timer);
  }
  return {
    child,
    closed,
    start: () => control.write(JSON.stringify({ argv }) + "\n"),
  };
}
