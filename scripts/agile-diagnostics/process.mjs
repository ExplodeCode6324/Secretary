import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fail } from "./io.mjs";
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export function environment() {
  const env = {
    PATH: "/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    LANG: "en_US.UTF-8",
  };
  for (const k of ["HOME", "USER", "LOGNAME", "TMPDIR"])
    if (process.env[k]) env[k] = process.env[k];
  return env;
}
export async function command(
  file,
  argv,
  {
    cwd,
    env = environment(),
    timeout = 30000,
    output,
    max = 4 * 1024 ** 2,
  } = {},
) {
  if (!path.isAbsolute(file)) fail("BINARY_NOT_ABSOLUTE");
  return new Promise((resolve, reject) => {
    const fd = output ? fs.openSync(output, "wx", 0o600) : undefined;
    const child = spawn(file, argv, {
      cwd,
      env,
      stdio: ["ignore", fd ?? "pipe", "pipe"],
    });
    let data = [],
      size = 0,
      failed = false;
    const timer = setTimeout(() => {
      failed = true;
      child.kill("SIGTERM");
    }, timeout);
    child.stdout?.on("data", (b) => {
      size += b.length;
      if (size > max) {
        failed = true;
        child.kill("SIGTERM");
      } else data.push(b);
    });
    child.stderr.on("data", () => {}); // Never expose command errors containing private config/SQL/paths.
    child.on("error", () => {
      failed = true;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (fd !== undefined) {
        fs.fsyncSync(fd);
        fs.closeSync(fd);
      }
      if (failed || code !== 0) reject(Error("COMMAND_FAILED"));
      else resolve(Buffer.concat(data).toString());
    });
  });
}
export async function holdLocks(python, files) {
  const child = spawn(
    python,
    [fileURLToPath(new URL("./lock-guard.py", import.meta.url)), ...files],
    { env: environment(), stdio: ["pipe", "pipe", "ignore"] },
  );
  let release = false;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.stdin.end();
      reject(Error("LOCK_TIMEOUT"));
    }, 5000);
    child.stdout.once("data", (b) => {
      clearTimeout(timer);
      if (b.toString().trim() === "LOCKED") resolve();
      else reject(Error("LOCK_FAILED"));
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(Error("LOCK_FAILED"));
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(Error("LOCK_FAILED"));
    });
  });
  return {
    pid: child.pid,
    alive: () => child.exitCode === null && !release,
    release: async () => {
      release = true;
      child.stdin.end();
      if (child.exitCode === null)
        await new Promise((r) => child.once("exit", r));
    },
  };
}
export async function processes() {
  const lines = (
    await command("/bin/ps", ["-axo", "pid=,ppid=,lstart=,command="])
  )
    .trim()
    .split("\n");
  return lines
    .map((line) => {
      const m = line
        .trim()
        .match(
          /^(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.*)$/,
        );
      return (
        m && {
          pid: +m[1],
          ppid: +m[2],
          started: Date.parse(m[3]),
          command: m[4],
        }
      );
    })
    .filter(Boolean);
}
export function descendants(rows, pid) {
  const ids = new Set([pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of rows)
      if (ids.has(p.ppid) && !ids.has(p.pid)) {
        ids.add(p.pid);
        changed = true;
      }
  }
  return rows.filter((p) => ids.has(p.pid));
}
