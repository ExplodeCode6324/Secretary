import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
export type Phase = "PREPARING" | "ARMED_FOR_MASTER" | "ACTIVE" | "EXHAUSTED";
export type BudgetRecord = {
  version: 1;
  phase: Phase;
  physical: number;
  tools: number;
  limits: { physical: number; tools: number };
  automatic_deadline: number;
  manual_started_at?: number;
  manual_deadline?: number;
  roles: Record<string, number>;
  refusals: { at: number; phase: Phase; reason: string }[];
  extensions: {
    at: number;
    reason: string;
    physical: number;
    tools: number;
    milliseconds: number;
  }[];
};
/** Called only under the harness's exclusive LocalFiles owner lock. Synchronous
 * fsync makes shared Main/Task admission atomic before any provider transmission. */
export class AcceptanceBudget {
  value: BudgetRecord;
  private failed = false;
  constructor(
    readonly file: string,
    readonly now = Date.now,
  ) {
    if (fs.existsSync(file)) {
      const st = fs.lstatSync(file);
      if (
        !st.isFile() ||
        st.isSymbolicLink() ||
        st.uid !== process.getuid?.() ||
        st.mode & 0o077
      )
        throw Error("UNSAFE_BUDGET_LEDGER");
      this.value = JSON.parse(fs.readFileSync(file, "utf8"));
      const v = this.value;
      if (
        v.version !== 1 ||
        !["PREPARING", "ARMED_FOR_MASTER", "ACTIVE", "EXHAUSTED"].includes(
          v.phase,
        ) ||
        !Number.isSafeInteger(v.physical) ||
        v.physical < 0 ||
        !Number.isSafeInteger(v.tools) ||
        v.tools < 0 ||
        !Number.isFinite(v.automatic_deadline) ||
        !Number.isSafeInteger(v.limits.physical) ||
        !Number.isSafeInteger(v.limits.tools) ||
        (v.phase === "ACTIVE" && (!v.manual_started_at || !v.manual_deadline))
      )
        throw Error("INVALID_BUDGET_LEDGER");
    } else {
      this.value = {
        version: 1,
        phase: "PREPARING",
        physical: 0,
        tools: 0,
        limits: { physical: 100, tools: 300 },
        automatic_deadline: now() + 7200000,
        roles: {},
        refusals: [],
        extensions: [],
      };
      this.save(this.value);
    }
  }
  private save(next: BudgetRecord) {
    const tmp = this.file + ".tmp-" + randomUUID();
    const fd = fs.openSync(tmp, "wx", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(next, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file);
    const dir = fs.openSync(path.dirname(this.file), "r");
    try {
      fs.fsyncSync(dir);
    } finally {
      fs.closeSync(dir);
    }
    this.value = next;
  }
  private update(change: (v: BudgetRecord) => void) {
    if (this.failed) throw Error("BUDGET_LEDGER_FAILED");
    const next = structuredClone(this.value);
    change(next);
    try {
      this.save(next);
    } catch (e) {
      this.failed = true;
      throw e;
    }
  }
  remaining() {
    return {
      physical: this.value.limits.physical - this.value.physical,
      tools: this.value.limits.tools - this.value.tools,
    };
  }
  enabled() {
    if (this.failed) return false;
    const v = this.value,
      deadline =
        v.phase === "ACTIVE" ? v.manual_deadline : v.automatic_deadline;
    return (
      (v.phase === "ACTIVE" || v.phase === "PREPARING") &&
      this.now() < deadline! &&
      v.physical < v.limits.physical &&
      v.tools < v.limits.tools
    );
  }
  expire() {
    if (
      (this.value.phase === "ACTIVE" || this.value.phase === "PREPARING") &&
      !this.enabled()
    )
      this.update((v) => {
        v.phase = "EXHAUSTED";
      });
    return this.value.phase === "EXHAUSTED";
  }
  admit() {
    if (this.enabled()) return;
    this.update((v) => {
      v.refusals.push({
        at: this.now(),
        phase: v.phase,
        reason: "MODEL_ADMISSION_REFUSED",
      });
      if (v.phase !== "ARMED_FOR_MASTER") v.phase = "EXHAUSTED";
    });
    throw Error("ACCEPTANCE_MODEL_ADMISSION_REFUSED");
  }
  attempt(role: string) {
    this.admit();
    this.update((v) => {
      v.physical++;
      v.roles[role] = (v.roles[role] ?? 0) + 1;
    });
  }
  proposals(count: number) {
    if (!Number.isSafeInteger(count) || count < 0)
      throw Error("INVALID_TOOL_COUNT");
    const previous = this.value;
    const deadline = previous.manual_deadline ?? previous.automatic_deadline;
    const allowed =
      ["PREPARING", "ACTIVE"].includes(previous.phase) && this.now() < deadline;
    // Every observed proposal is charged, even a late/aborted response. Execution
    // is withheld until this durable update and the phase check both succeed.
    this.update((v) => {
      v.tools += count;
      if (
        v.tools > v.limits.tools ||
        (!allowed && v.phase !== "ARMED_FOR_MASTER")
      )
        v.phase = "EXHAUSTED";
    });
    if (!allowed) throw Error("ACCEPTANCE_PHASE_CHANGED");
    if (this.value.tools > this.value.limits.tools)
      throw Error("ACCEPTANCE_TOOL_LIMIT");
  }
  requireReserve() {
    const r = this.remaining();
    if (
      r.physical < 60 ||
      r.tools < 180 ||
      (this.value.manual_deadline &&
        this.value.manual_deadline - this.now() < 5400000)
    )
      throw Error("HANDOFF_RESERVE_REQUIRED");
  }
  arm() {
    this.requireReserve();
    if (this.value.manual_started_at) throw Error("MANUAL_ALREADY_STARTED");
    this.update((v) => {
      v.phase = "ARMED_FOR_MASTER";
    });
  }
  connect(ready: () => void) {
    if (this.value.phase === "ACTIVE") {
      this.admit();
      return;
    }
    if (this.value.phase !== "ARMED_FOR_MASTER")
      throw Error("ACCEPTANCE_NOT_ARMED");
    ready();
    this.requireReserve();
    this.update((v) => {
      v.manual_started_at = this.now();
      v.manual_deadline = this.now() + 7200000;
      v.phase = "ACTIVE";
    });
  }
  prepare() {
    this.requireReserve();
    if (this.value.manual_started_at) {
      this.admit();
      return;
    }
    if (this.now() >= this.value.automatic_deadline)
      throw Error("PREPARATION_DEADLINE_EXPIRED");
    this.update((v) => {
      v.phase = "PREPARING";
    });
  }
  extend(event: {
    reason: string;
    physical: number;
    tools: number;
    milliseconds: number;
  }) {
    if (
      !event.reason ||
      Object.values(event).some(
        (v) => typeof v === "number" && (!Number.isSafeInteger(v) || v < 0),
      )
    )
      throw Error("INVALID_EXTENSION");
    this.update((v) => {
      v.extensions.push({ at: this.now(), ...event });
      v.limits.physical += event.physical;
      v.limits.tools += event.tools;
      if (v.manual_deadline) {
        v.manual_deadline =
          Math.max(v.manual_deadline, this.now()) + event.milliseconds;
        v.phase = "ACTIVE";
      } else {
        v.automatic_deadline =
          Math.max(v.automatic_deadline, this.now()) + event.milliseconds;
        v.phase = "PREPARING";
      }
    });
  }
}
