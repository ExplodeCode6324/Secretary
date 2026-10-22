/** One scheduled update per frame; missed deadlines remain visible as lateness. */
export const tickDue = (
  elapsed: number,
  completed: number,
  period: number,
  total: number,
) => completed < total && elapsed >= completed * period;
