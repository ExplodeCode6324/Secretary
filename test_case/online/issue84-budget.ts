import fs from "node:fs";
import { createHash } from "node:crypto";
import type { Usage } from "@earendil-works/pi-ai";
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
export type Policy = "bounded" | "observe";
export type Role = "main" | "task";
export type RequestKind = "normal" | "summary" | "extraction";
export const attemptMs = 120_000;
export const windowMs = 7_200_000;
export const outputCap = 8192;
export const inputCap = 100_000;
// Nano-USD: $0.30 and $1.20 per million tokens at peak, with no cache discount.
const cost = (input: number, output: number) => 300 * input + 1200 * output;
export const limits = {
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

export type Attempt = ReturnType<typeof wireBound> & {
  role: Role;
  phase: Phase;
  domain?: string;
  sessionId?: string;
  usage?: Usage;
  started: number;
  ms: number;
  nanoUSD: number;
  http?: number;
  requestId?: string;
  responseId?: string;
  actualInput?: number;
  actualOutput?: number;
  inputIds: string[];
  ended?: number;
  termination?: string;
  observedMs?: number;
  kind?: RequestKind;
};
type ToolBatch = {
  phase: Phase;
  names: string[];
  admitted: boolean;
  domain?: string;
  responseId?: string;
};
export type LedgerState = {
  policy?: Policy;
  provenance?: {
    path: string;
    sha256: string;
    head: string;
    policy: Policy;
    evidence: { path: string; sha256: string }[];
  }[];
  phase: Phase;
  release: Phase | null;
  halted: string | null;
  attempts: Attempt[];
  batches: ToolBatch[];
  refusals: { at: number; phase: Phase; reason: string }[];
  finalNative?: boolean;
};
export class Issue84Budget {
  readonly state: LedgerState;
  constructor(
    readonly file: string,
    resume: boolean,
    readonly policy: Policy = "bounded",
    history?: { path: string; sha256: string },
  ) {
    requireBudget(["bounded", "observe"].includes(policy), "POLICY");
    requireBudget(
      !history || (!resume && policy === "observe"),
      "HISTORY_MODE",
    );
    this.state = resume
      ? JSON.parse(fs.readFileSync(file, "utf8"))
      : {
          phase: "main",
          release: null,
          halted: null,
          attempts: [],
          batches: [],
          refusals: [],
        };
    requireBudget(
      !resume || (this.state.policy ?? "bounded") === policy,
      "POLICY_CHANGED",
    );
    this.state.policy = policy;
    this.state.refusals ??= [];
    if (history) {
      const raw = fs.readFileSync(history.path);
      const digest = (bytes: Buffer) =>
        createHash("sha256").update(bytes).digest("hex");
      requireBudget(digest(raw) === history.sha256, "HISTORY_HASH");
      const frozen = JSON.parse(raw.toString());
      requireBudget(
        Array.isArray(frozen.evidence) && frozen.evidence.length >= 5,
        "HISTORY_EVIDENCE",
      );
      for (const e of frozen.evidence)
        requireBudget(
          digest(fs.readFileSync(e.path)) === e.sha256,
          "HISTORY_EVIDENCE_CHANGED",
        );
      const source = frozen.evidence.find(
        (e: { path: string }) => e.path === frozen.ledger,
      );
      requireBudget(source, "HISTORY_LEDGER_MISSING");
      const prior = JSON.parse(
        fs.readFileSync(source.path, "utf8"),
      ) as LedgerState;
      requireBudget(
        Array.isArray(prior.attempts) &&
          Array.isArray(prior.batches) &&
          Array.isArray(prior.refusals),
        "HISTORY_SHAPE",
      );
      for (const a of prior.attempts)
        requireBudget(
          a.ended !== undefined &&
            Number.isFinite(a.ended) &&
            a.ended >= a.started &&
            [a.started, a.ms, a.nanoUSD, a.input, a.output].every(
              (n) => Number.isSafeInteger(n) && n >= 0,
            ) &&
            ["main", "task"].includes(a.role) &&
            phases.includes(a.phase) &&
            Array.isArray(a.inputIds),
          "HISTORY_ATTEMPT",
        );
      for (const b of prior.batches)
        requireBudget(
          phases.includes(b.phase) &&
            Array.isArray(b.names) &&
            b.names.every((n) => typeof n === "string") &&
            typeof b.admitted === "boolean",
          "HISTORY_BATCH",
        );
      this.state.attempts = prior.attempts.map((a) => ({
        ...a,
        domain: a.domain ?? path.dirname(source.path),
      }));
      this.state.batches = prior.batches.map((b) => ({
        ...b,
        domain: b.domain ?? path.dirname(source.path),
      }));
      this.state.refusals = prior.refusals;
      this.state.provenance = [
        ...(prior.provenance ?? []),
        {
          path: path.resolve(history.path),
          sha256: history.sha256,
          head: frozen.head,
          policy: prior.policy ?? "bounded",
          evidence: frozen.evidence,
        },
      ];
    }
    for (const prior of this.state.provenance ?? []) {
      requireBudget(
        createHash("sha256")
          .update(fs.readFileSync(prior.path))
          .digest("hex") === prior.sha256,
        "HISTORY_HASH",
      );
      for (const e of prior.evidence)
        requireBudget(
          createHash("sha256").update(fs.readFileSync(e.path)).digest("hex") ===
            e.sha256,
          "HISTORY_EVIDENCE_CHANGED",
        );
    }
    if (resume)
      for (const attempt of this.state.attempts) {
        if (attempt.ended === undefined) {
          attempt.ended = Date.now();
          attempt.termination = "unknown_after_restart";
          // Unknown requests retain their full time AND cost reservations.
          attempt.ms = attemptMs;
        }
      }
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
    requireBudget(!this.state.finalNative, "FINAL_NATIVE_ONLY");
    requireBudget(
      phases.indexOf(phase) === phases.indexOf(this.state.phase) + 1 &&
        phase !== "reserve",
      "PHASE_ORDER",
    );
    requireBudget(
      this.state.attempts.every((a) => a.ended !== undefined),
      "UNFINISHED_ATTEMPTS",
    );
    const future = phases.slice(phases.indexOf(phase));
    const held = this.state.attempts.reduce((n, a) => n + a.ms, 0);
    const spentReserve = this.state.attempts
      .filter((a) => a.phase === "reserve")
      .reduce((n, a) => n + a.ms, 0);
    requireBudget(
      this.policy === "observe" ||
        held +
          future.reduce(
            (n, p) =>
              n +
              Math.max(0, limits[p].ms - (p === "reserve" ? spentReserve : 0)),
            0,
          ) <=
          1_500_000,
      "FUTURE_PATH_TIME",
    );
    this.state.phase = phase;
    this.state.release = null;
    this.save();
  }
  releaseReserve() {
    this.state.release = this.state.phase;
    this.save();
  }
  revisitNativeVision() {
    requireBudget(
      this.state.phase === "redo" && !this.state.finalNative,
      "NATIVE_ORDER",
    );
    requireBudget(
      this.state.attempts.every((a) => a.ended !== undefined),
      "UNFINISHED_ATTEMPTS",
    );
    this.state.phase = "vision";
    this.state.release = null;
    this.state.finalNative = true;
    // Master's requested automatic-first handoff: reuse only the ORIGINAL
    // unspent vision allocation; never reset attempts, wall clock or costs.
    this.save();
  }
  admit(
    role: Role,
    wire: ReturnType<typeof wireBound>,
    inputIds: string[],
    kind: RequestKind = "normal",
  ) {
    try {
      return this.admitAttempt(role, wire, inputIds, kind);
    } catch (error) {
      this.state.refusals.push({
        at: Date.now(),
        phase: this.state.phase,
        reason: String(error),
      });
      this.save();
      throw error;
    }
  }
  private admitAttempt(
    role: Role,
    wire: ReturnType<typeof wireBound>,
    inputIds: string[],
    kind: RequestKind,
  ) {
    requireBudget(!this.state.halted, "HALTED");
    const started = Date.now();
    const { phase, attempts } = this.state;
    requireBudget(
      this.policy === "observe" ||
        !attempts.length ||
        started - attempts[0].started < windowMs,
      "WALL_TIME",
    );
    const nanoUSD = cost(wire.input, wire.output);
    requireBudget(
      this.policy === "observe" ||
        attempts.reduce((sum, a) => sum + a.nanoUSD, nanoUSD) <= 5_000_000_000,
      "USD",
    );
    const bucket = this.state.release === phase ? "reserve" : phase;
    const fits = (p: Phase) => {
      const previous = attempts.filter((a) => a.phase === p);
      return previous.filter((a) => a.role === role).length < limits[p][role];
    };
    requireBudget(this.policy === "observe" || fits(bucket), "PATH_CALLS");
    if (this.policy === "bounded" && role === "main" && kind === "normal") {
      const used = attempts.filter(
        (a) => a.phase === bucket && a.role === "main",
      ).length;
      requireBudget(limits[bucket].main - used > 2, "MAINTENANCE_HEADROOM");
    }
    requireBudget(
      this.policy === "observe" ||
        attempts.reduce((sum, a) => sum + a.ms, attemptMs) <= 1_500_000,
      "ACTIVE_TIME",
    );
    const attempt: Attempt = {
      ...wire,
      role,
      domain: path.dirname(this.file),
      phase: bucket,
      started,
      ms: attemptMs,
      nanoUSD,
      inputIds,
      kind,
    };
    attempts.push(attempt);
    this.save();
    return attempt;
  }
  end(attempt: Attempt, ended: number, termination: string) {
    if (attempt.ended !== undefined) return;
    const elapsed = ended - attempt.started;
    if (elapsed < 0) {
      this.state.halted = "UNVERIFIED_PROVIDER_USAGE_OR_DEADLINE";
      this.save();
      throw Error("BUDGET_ISSUE84_" + this.state.halted);
    }
    Object.assign(attempt, {
      ms: Math.min(elapsed, attemptMs),
      observedMs: elapsed,
      ended,
      termination,
    });
    // An observed end releases time, never an unverified cost reservation.
    this.save();
  }
  finish(
    attempt: Attempt,
    ended: number,
    responseId: string,
    input: number,
    output: number,
    usage?: Usage,
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
      (!usage ||
        ([
          usage.input,
          usage.output,
          usage.cacheRead,
          usage.cacheWrite,
          usage.totalTokens,
          usage.reasoning ?? 0,
        ].every((n) => Number.isSafeInteger(n) && n >= 0) &&
          usage.input + usage.cacheRead + usage.cacheWrite === input &&
          usage.output === output &&
          usage.totalTokens === input + output &&
          (usage.reasoning ?? 0) <= output));
    if (!valid) {
      this.state.halted = "UNVERIFIED_PROVIDER_USAGE_OR_DEADLINE";
      this.save();
      throw Error("BUDGET_ISSUE84_" + this.state.halted);
    }
    Object.assign(attempt, {
      ms: Math.min(elapsed, attemptMs),
      observedMs: elapsed,
      ended,
      termination: "completed",
      nanoUSD: cost(input, output),
      responseId,
      actualInput: input,
      actualOutput: output,
      ...(usage ? { usage } : {}),
    });
    this.save();
  }
  tools(role: Role, names: string[], attempt: Attempt, scopeAllowed = true) {
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
    const generated = this.state.batches
      .filter((b) => b.phase === phase)
      .flatMap((b) => b.names)
      .filter((n) => n === "task_propose").length;
    const admitted =
      scopeAllowed &&
      names.every((name) => allowed.includes(name)) &&
      (this.policy === "observe" ||
        (counted.length + names.length <= limits[phase].tools &&
          generated + names.filter((n) => n === "task_propose").length <=
            limits[phase].proposals));
    if (names.length) {
      this.state.batches.push({
        phase,
        names,
        admitted,
        domain: path.dirname(this.file),
        responseId: attempt.responseId,
      });
      this.save();
    }
    requireBudget(admitted, "TOOLS_OR_PROPOSALS");
  }
}
