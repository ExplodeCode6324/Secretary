export const FINAL_READING_MARKER = "FE04-FINAL-READING-R3";
export const FINAL_READING_SCENARIO = "final-reading-r3";
export function boundedModel<T extends { maxTokens: number }>(model: T): T {
  return { ...model, maxTokens: Math.min(model.maxTokens, 4096) };
}
/** Called before LiveBudget admission; startup/maintenance cannot spend it. */
export function assertFinalReadingRequest(
  role: string,
  messages: { role: string; content: unknown }[],
  maxTokens?: number,
) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (
    role !== "main" ||
    !JSON.stringify(lastUser?.content ?? "").includes(FINAL_READING_MARKER)
  )
    throw Error("FINAL_READING_NOT_ARMED");
  if (!maxTokens || maxTokens > 4096 || maxTokens <= 0)
    throw Error("FINAL_READING_OUTPUT_BUDGET_NOT_CONFIGURED");
}
