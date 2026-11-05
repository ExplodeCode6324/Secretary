import fs from "node:fs";
import path from "node:path";
import { imageLeaves } from "../../src/pi_secretary/src/vision.ts";

export const phases = [
  "main",
  "vision",
  "shared",
  "matters",
  "redo",
  "reserve",
] as const;
export type Phase = (typeof phases)[number];
export type Role = "main" | "task";
export const attemptMs = 120_000;
export const windowMs = 7_200_000;
export const outputCap = 8192;
export const inputCap = 100_000;
// Nano-USD: $0.30 and $1.20 per million tokens at peak, with no cache discount.
const cost = (input: number, output: number) => 300 * input + 1200 * output;
const limits = {
  main: { main: 8, task: 0, proposals: 0, tools: 12, ms: 171_000 },
  vision: { main: 6, task: 0, proposals: 0, tools: 8, ms: 158_000 },
  shared: { main: 20, task: 14, proposals: 3, tools: 55, ms: 337_000 },
  matters: { main: 20, task: 14, proposals: 3, tools: 55, ms: 337_000 },
  redo: { main: 18, task: 10, proposals: 3, tools: 45, ms: 299_000 },
  reserve: { main: 8, task: 4, proposals: 1, tools: 25, ms: 198_000 },
};
function requireBudget(ok: unknown, reason: string): asserts ok {
  if (!ok) throw Error("BUDGET_ISSUE84_" + reason);
}
export function wireBound(body: string) {
  const payload = JSON.parse(body);
  const output = payload.max_tokens ?? payload.max_completion_tokens;
  requireBudget(
    payload.model === "deepseek-flash" &&
      payload.stream === true &&
      Array.isArray(payload.messages) &&
      Number.isSafeInteger(output) &&
      output > 0 &&
      output <= outputCap &&
      !(payload.max_tokens && payload.max_completion_tokens),
    "WIRE_SHAPE",
  );
  const images = imageLeaves(payload);
  const textBytes =
    Buffer.byteLength(body) -
    images.reduce((n, image) => n + image.data.length, 0);
  const input =
    textBytes +
    1024 +
    64 * (payload.messages.length + (payload.tools?.length ?? 0)) +
    1024 * images.length;
  requireBudget(input <= inputCap, "WIRE_INPUT");
  return {
    input,
    output: output as number,
    images: images.map(({ sha256, bytes }) => ({ sha256, bytes })),
  };
}

type Attempt = ReturnType<typeof wireBound> & {
  role: Role;
  phase: Phase;
  started: number;
  ms: number;
  nanoUSD: number;
  http?: number;
  requestId?: string;
  responseId?: string;
  actualInput?: number;
  actualOutput?: number;
  inputIds: string[];
};
type ToolBatch = { phase: Phase; names: string[]; admitted: boolean };
type LedgerState = {
  phase: Phase;
  release: Phase | null;
  halted: string | null;
  attempts: Attempt[];
  batches: ToolBatch[];
};
export class Issue84Budget {
  readonly state: LedgerState;
  constructor(
    readonly file: string,
    resume: boolean,
  ) {
    this.state = resume
      ? JSON.parse(fs.readFileSync(file, "utf8"))
      : {
          phase: "main",
          release: null,
          halted: null,
          attempts: [],
          batches: [],
        };
    this.save();
  }
  save() {
    const pending = this.file + ".next";
    fs.writeFileSync(pending, JSON.stringify(this.state, null, 2) + "\n", {
      mode: 0o600,
    });
    const fd = fs.openSync(pending, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(pending, this.file);
    const directory = fs.openSync(path.dirname(this.file), "r");
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  }
  advance(phase: Phase) {
    requireBudget(
      phases.indexOf(phase) === phases.indexOf(this.state.phase) + 1 &&
        phase !== "reserve",
      "PHASE_ORDER",
    );
    this.state.phase = phase;
    this.state.release = null;
    this.save();
  }
  releaseReserve() {
    this.state.release = this.state.phase;
    this.save();
  }
  admit(role: Role, wire: ReturnType<typeof wireBound>, inputIds: string[]) {
    requireBudget(!this.state.halted, "HALTED");
    const started = Date.now();
    const { phase, attempts } = this.state;
    requireBudget(
      !attempts.length || started - attempts[0].started < windowMs,
      "WALL_TIME",
    );
    const nanoUSD = cost(wire.input, wire.output);
    requireBudget(
      attempts.reduce((sum, a) => sum + a.nanoUSD, nanoUSD) <= 5_000_000_000,
      "USD",
    );
    let bucket = phase;
    const fits = (p: Phase) => {
      const previous = attempts.filter((a) => a.phase === p);
      return (
        previous.filter((a) => a.role === role).length < limits[p][role] &&
        previous.reduce((sum, a) => sum + a.ms, attemptMs) <= limits[p].ms
      );
    };
    if (!fits(bucket) && this.state.release === phase) bucket = "reserve";
    requireBudget(fits(bucket), "PATH_TIME_OR_CALLS");
    requireBudget(
      attempts.reduce((sum, a) => sum + a.ms, attemptMs) <= 1_500_000,
      "ACTIVE_TIME",
    );
    const attempt: Attempt = {
      ...wire,
      role,
      phase: bucket,
      started,
      ms: attemptMs,
      nanoUSD,
      inputIds,
    };
    attempts.push(attempt);
    this.save();
    return attempt;
  }
  finish(
    attempt: Attempt,
    ended: number,
    responseId: string,
    input: number,
    output: number,
  ) {
    const elapsed = ended - attempt.started;
    const valid =
      Number.isSafeInteger(input) &&
      input > 0 &&
      input <= attempt.input &&
      Number.isSafeInteger(output) &&
      output >= 0 &&
      output <= attempt.output &&
      elapsed >= 0 &&
      elapsed <= attemptMs;
    if (!valid) {
      this.state.halted = "UNVERIFIED_PROVIDER_USAGE_OR_DEADLINE";
      this.save();
      throw Error("BUDGET_ISSUE84_" + this.state.halted);
    }
    Object.assign(attempt, {
      ms: elapsed,
      nanoUSD: cost(input, output),
      responseId,
      actualInput: input,
      actualOutput: output,
    });
    this.save();
  }
  tools(role: Role, names: string[], attempt: Attempt) {
    const phase = attempt.phase;
    const allowed =
      role === "main"
        ? [
            "task_propose",
            "task_query",
            "task_control",
            "memory_search",
            "memory_read",
            "MasterInteract",
          ]
        : ["read", "write", "submit_result", "request_decision"];
    const counted = this.state.batches
      .filter((batch) => batch.phase === phase && batch.admitted)
      .flatMap((batch) => batch.names);
    const admitted =
      names.every((name) => allowed.includes(name)) &&
      counted.length + names.length <= limits[phase].tools &&
      [...counted, ...names].filter((n) => n === "task_propose").length <=
        limits[phase].proposals;
    if (names.length) {
      this.state.batches.push({ phase, names, admitted });
      this.save();
    }
    requireBudget(admitted, "TOOLS_OR_PROPOSALS");
  }
}
