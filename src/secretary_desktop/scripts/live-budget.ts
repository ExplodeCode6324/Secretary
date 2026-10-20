/** Test-runner budget: admission before every real provider start, shared by both roles. */
export class LiveBudget {
  readonly started: number;
  private tail = Promise.resolve();
  private last = 0;
  private total = 0;
  private scenarios = new Map<string, { count: number; started: number }>();
  constructor(
    readonly limits = {
      scenarioCalls: 12,
      totalCalls: 48,
      scenarioMs: 600000,
      totalMs: 2400000,
      spacingMs: 20000,
    },
    history: {
      scenario: string;
      started_at: string;
      deadline: number;
      run_started_at: number;
    }[] = [],
    runStartedAt?: number,
  ) {
    this.started =
      runStartedAt ?? (history.length ? history[0].run_started_at : Date.now());
    if (
      !Number.isFinite(this.started) ||
      history.some(
        (c) =>
          c.run_started_at !== this.started ||
          !Number.isFinite(Date.parse(c.started_at)) ||
          this.started > Date.parse(c.started_at),
      )
    ) {
      throw Error("LIVE_LEDGER_ORIGIN_MISSING_OR_INCONSISTENT");
    }
    for (const c of history) {
      const at = Date.parse(c.started_at);
      const entry = this.scenarios.get(c.scenario) ?? {
        count: 0,
        started: c.deadline - this.limits.scenarioMs,
      };
      entry.count++;
      this.scenarios.set(c.scenario, entry);
      this.total++;
      this.last = Math.max(this.last, at);
    }
  }
  async enter(scenario: string, signal?: AbortSignal) {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((r) => (release = r));
    try {
      await previous;
      signal?.throwIfAborted();
      const entry = this.scenarios.get(scenario) ?? {
        count: 0,
        started: Date.now(),
      };
      this.scenarios.set(scenario, entry);
      const deadline = Math.min(
        this.started + this.limits.totalMs,
        entry.started + this.limits.scenarioMs,
      );
      const delay = Math.max(0, this.last + this.limits.spacingMs - Date.now());
      if (
        Date.now() + delay >= deadline ||
        this.total >= this.limits.totalCalls ||
        entry.count >= this.limits.scenarioCalls
      )
        throw Error("LIVE_BUDGET_EXHAUSTED");
      if (delay)
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(done, delay);
          function done() {
            signal?.removeEventListener("abort", abort);
            resolve();
          }
          function abort() {
            clearTimeout(t);
            reject(Error("LIVE_ABORTED"));
          }
          signal?.addEventListener("abort", abort, { once: true });
        });
      signal?.throwIfAborted();
      if (Date.now() >= deadline) throw Error("LIVE_BUDGET_EXHAUSTED");
      this.total++;
      entry.count++;
      this.last = Date.now();
      return {
        run_started_at: this.started,
        number: this.total,
        scenarioNumber: entry.count,
        deadline,
        release,
      };
    } catch (e) {
      release();
      throw e;
    }
  }
}
