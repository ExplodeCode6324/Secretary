import { platform, release, arch } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pythonPrerequisite } from "./issue82-g0/writer.ts";
import { clipboardCapability } from "./issue82-g0/clipboard.ts";
const bounded = (path: string, argv: string[]) => {
  if (!existsSync(path)) return { available: false };
  const result = spawnSync(path, argv, {
    encoding: "utf8",
    timeout: 2000,
    maxBuffer: 16384,
  });
  return {
    available: true,
    exit: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error?.message,
  };
};
let python;
try {
  python = { status: "PASS", version: pythonPrerequisite() };
} catch (error) {
  python = { status: "FAIL", error: String(error) };
  process.exitCode = 1;
}
console.log(
  JSON.stringify(
    {
      at: new Date().toISOString(),
      platform: platform(),
      release: release(),
      arch: arch(),
      osRelease: existsSync("/etc/os-release")
        ? readFileSync("/etc/os-release", "utf8")
        : undefined,
      node: process.version,
      python,
      stdinTTY: !!process.stdin.isTTY,
      stdoutTTY: !!process.stdout.isTTY,
      terminal: process.env.TERM,
      termProgram: process.env.TERM_PROGRAM,
      displayConfigured: !!process.env.DISPLAY,
      waylandConfigured: !!process.env.WAYLAND_DISPLAY,
      locale: {
        LANG: process.env.LANG,
        LC_CTYPE: process.env.LC_CTYPE,
        installed: bounded("/usr/bin/locale", ["-a"]),
      },
      fonts: bounded("/usr/bin/fc-match", ["monospace:lang=zh-cn"]),
      clipboard: clipboardCapability(),
      warning:
        "Environment presence is not GUI, IME, clipboard, font-rendering or real-terminal acceptance; reviewer must report capabilities actually exercised.",
    },
    null,
    2,
  ),
);
