import { budgetConfig } from "../../src/pi_secretary/src/budget.ts";

export function configureLiveOutputBudget(outputLimit: number) {
  if (!Number.isSafeInteger(outputLimit) || outputLimit < 1)
    throw Error("INVALID_LIVE_OUTPUT_LIMIT");
  // Configure before Core freezes normal, summary and retry budgets. A late
  // stream-only clamp would disagree with the durable request's exact ceiling.
  const caps = (["main", "task"] as const).map((role) => ({
    key: `SECRETARY_${role.toUpperCase()}_OUTPUT_TOKENS`,
    value: Math.min(budgetConfig(role).outputLimit ?? outputLimit, outputLimit),
  }));
  for (const { key, value } of caps) process.env[key] = String(value);
}
