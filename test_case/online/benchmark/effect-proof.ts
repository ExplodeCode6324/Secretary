import type { Operation } from "../../../src/pi_secretary/src/contracts.ts";
import { sha } from "./io.ts";

/** Successful applyWrite receipt only; UNKNOWN errors and reconciliation are not writes. */
export function completedFileWrite(
  operation: Operation,
  receipt: any,
  outcome: unknown,
  resourceBytes: () => Buffer,
  casBytes: () => Buffer,
) {
  return (
    operation.action.action === "file.write" &&
    operation.state === "DISPATCHED" &&
    outcome !== "UNKNOWN" &&
    !!receipt?.result &&
    !!receipt?.evidence &&
    /^[a-f0-9]{64}$/.test(receipt.evidence.sha256) &&
    sha(resourceBytes()) === receipt.evidence.sha256 &&
    sha(casBytes()) === receipt.evidence.sha256
  );
}
