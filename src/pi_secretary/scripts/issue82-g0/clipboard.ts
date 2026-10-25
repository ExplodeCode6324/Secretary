import { spawnSync } from "node:child_process";

// Linux GUI clipboard integration is deliberately not assumed from DISPLAY,
// Wayland variables, or installed executables. No OSC52/native addon fallback.
export function clipboardCapability(
  platform: NodeJS.Platform = process.platform,
): "pbcopy" | "unsupported" {
  return platform === "darwin" ? "pbcopy" : "unsupported";
}
export const clipboardEnv = {
  PATH: "/usr/bin:/bin",
  LANG: "en_US.UTF-8",
  LC_CTYPE: "en_US.UTF-8",
};
export function copyVisibleText(text: string): { ok: boolean; reason: string } {
  if (clipboardCapability() === "unsupported")
    return {
      ok: false,
      reason:
        "UNSUPPORTED: no verified clipboard backend on this platform; clipboard unchanged",
    };
  if (Buffer.byteLength(text) > 128 * 1024)
    return { ok: false, reason: "Copy exceeds 128 KiB; clipboard unchanged" };
  const result = spawnSync("/usr/bin/pbcopy", [], {
    input: text,
    encoding: "utf8",
    timeout: 2000,
    env: clipboardEnv,
  });
  return {
    ok: result.status === 0,
    reason:
      result.status === 0
        ? "Copied visible rendered text (soft wraps included)"
        : `Clipboard copy failed: ${result.error?.message ?? result.status}`,
  };
}
