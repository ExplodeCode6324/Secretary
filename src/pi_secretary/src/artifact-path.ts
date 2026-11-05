import fs from "node:fs";
import path from "node:path";
import type { Artifact, Execution } from "./contracts.ts";

/** Lexical registration identity, never Unicode/case rewriting of a real path. */
export function canonicalArtifactPath(value: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    Buffer.byteLength(value) > 4096 ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    /[\x00-\x1f\x7f-\x9f]/u.test(value) ||
    value.includes("\\")
  )
    throw Error("INVALID_ARTIFACT_PATH");
  const parts = value.split("/");
  if (parts.some((p) => p === ".." || p === ""))
    throw Error("INVALID_ARTIFACT_PATH");
  const normalized = parts.filter((p) => p !== ".").join("/");
  if (!normalized || /^[ @~]/.test(normalized))
    throw Error("INVALID_ARTIFACT_PATH");
  return normalized;
}
export function describedArtifacts(
  paths: string[],
  descriptions?: { path: string; description: string }[],
) {
  if (paths.length > 32) throw Error("TOO_MANY_ARTIFACTS");
  const canonical = paths.map(canonicalArtifactPath);
  if (
    new Set(canonical.map((p) => p.normalize("NFC"))).size !== canonical.length
  )
    throw Error("DUPLICATE_ARTIFACT_PATH");
  if (!paths.length && !descriptions?.length) return [];
  if (
    !descriptions ||
    descriptions.length !== paths.length ||
    Buffer.byteLength(JSON.stringify(descriptions)) > 65536
  )
    throw Error("ARTIFACT_DESCRIPTIONS_REQUIRED");
  const byPath = new Map<string, string>();
  for (const d of descriptions) {
    const p = canonicalArtifactPath(d.path);
    if (
      !d.description.trim() ||
      [...d.description].length > 2000 ||
      byPath.has(p) ||
      !canonical.includes(p)
    )
      throw Error("INVALID_ARTIFACT_DESCRIPTION");
    byPath.set(p, d.description);
  }
  return canonical.map((p) => ({ path: p, description: byPath.get(p)! }));
}

/** A display locator only. Content access always uses the authenticated artifact ID. */
export function artifactPath(artifact: Artifact, execution: Execution) {
  let relative: string | null = null,
    reason: string | null = null;
  try {
    relative = canonicalArtifactPath(artifact.workspace_path);
  } catch {
    reason = !artifact.workspace_path
      ? "MISSING_PATH"
      : Buffer.byteLength(artifact.workspace_path) > 4096
        ? "PATH_TOO_LONG"
        : "INVALID_PATH";
  }
  if (!reason && !execution.workspace_binding) reason = "MISSING_BASE";
  return {
    relative_path: reason ? null : relative,
    path_base: reason
      ? ("unknown" as const)
      : execution.workspace_binding!.kind === "DIRECTORY"
        ? ("scope" as const)
        : ("task" as const),
    scope_id: execution.scope_id ?? null,
    path_unavailable_reason: reason,
  };
}

/** Read-only observation of the frozen execution root. Never consult mutable Scope. */
export function currentArtifactPath(artifact: Artifact, execution: Execution) {
  const locator = artifactPath(artifact, execution);
  const root = execution.workspace_binding?.root_path;
  let reason = locator.path_unavailable_reason;
  const source_root = root && path.isAbsolute(root) ? root : null;
  if (!reason && !source_root) reason = "INVALID_BASE";
  const current_path =
    !reason && source_root && locator.relative_path
      ? path.join(source_root, locator.relative_path)
      : null;
  if (current_path) {
    try {
      const parsed = path.parse(current_path);
      let current = parsed.root;
      const parts = current_path.slice(parsed.root.length).split(path.sep);
      for (const [i, p] of parts.entries()) {
        current = path.join(current, p);
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) throw Error("SYMLINK");
        if (i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())
          throw Error("NOT_REGULAR_FILE");
      }
    } catch (error) {
      reason =
        (error as NodeJS.ErrnoException).code ?? (error as Error).message;
    }
  }
  return {
    ...locator,
    source_root,
    current_path,
    current_state: reason ? ("unavailable" as const) : ("available" as const),
    observed_at: new Date().toISOString(),
    current_unavailable_reason: reason,
  };
}
