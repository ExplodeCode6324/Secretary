import path from "node:path";
import type { Artifact, Execution } from "./contracts.ts";

/** A display locator only. Content access always uses the authenticated artifact ID. */
export function artifactPath(artifact: Artifact, execution: Execution) {
  const value = artifact.workspace_path;
  let reason: string | null = null;
  if (typeof value !== "string" || !value) reason = "MISSING_PATH";
  else if (Buffer.byteLength(value) > 4096) reason = "PATH_TOO_LONG";
  else if (
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    value.includes("\0") ||
    value.split(/[\\/]/).includes("..")
  )
    reason = "INVALID_PATH";
  else if (!execution.workspace_binding) reason = "MISSING_BASE";
  return {
    relative_path: reason ? null : value,
    path_base: reason
      ? ("unknown" as const)
      : execution.workspace_binding!.kind === "DIRECTORY"
        ? ("scope" as const)
        : ("task" as const),
    scope_id: execution.scope_id ?? null,
    path_unavailable_reason: reason,
  };
}
