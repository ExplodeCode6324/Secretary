import type { AcceptanceBudget } from "./issue106-budget.ts";
/** The same owner-controlled pump is used by the live service and restart tests. */
export class AcceptanceLifecycle {
  enabled: boolean;
  job?: Promise<void>;
  private aborted = false;
  constructor(
    readonly budget: AcceptanceBudget,
    readonly pump: () => Promise<void>,
    readonly abort: () => void,
    readonly onError: (error: unknown) => void,
  ) {
    this.enabled = budget.value.phase === "ACTIVE" && budget.enabled();
  }
  tick() {
    if (this.budget.expire()) {
      this.enabled = false;
      if (!this.aborted) {
        this.aborted = true;
        this.abort();
      }
    }
    if (this.enabled && this.budget.enabled() && !this.job)
      this.job = this.pump()
        .catch(this.onError)
        .finally(() => {
          this.job = undefined;
        });
  }
  async stop() {
    this.enabled = false;
    await this.job;
  }
}
