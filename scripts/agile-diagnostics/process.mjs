import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
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
    killGrace = 2000,
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
      failed = false,
      hardTimer,
      settled = false;
    const settle = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(hardTimer);
      if (fd !== undefined) {
        fs.fsyncSync(fd);
        fs.closeSync(fd);
      }
      if (failed || code !== 0) reject(Error("COMMAND_FAILED"));
      else resolve(Buffer.concat(data).toString());
    };
    const terminate = () => {
      failed = true;
      child.kill("SIGTERM");
      if (!hardTimer)
        hardTimer = setTimeout(() => {
          child.kill("SIGKILL");
          child.stdout?.destroy();
          child.stderr.destroy();
          settle(-1);
        }, killGrace);
    };
    const timer = setTimeout(() => {
      terminate();
    }, timeout);
    child.stdout?.on("data", (b) => {
      size += b.length;
      if (size > max) {
        terminate();
      } else data.push(b);
    });
    child.stderr.on("data", () => {}); // Never expose command errors containing private config/SQL/paths.
    child.on("error", () => {
      failed = true;
    });
    child.on("close", settle);
  });
}
export async function holdLocks(python, files) {
  const child = spawn(
    python,
    [fileURLToPath(new URL("./lock-guard.py", import.meta.url)), ...files],
    { env: environment(), detached: true, stdio: ["pipe", "pipe", "ignore"] },
  );
  let release = false,
    identities,
    exited = false;
  const exitPromise = new Promise((resolve) =>
    child.once("exit", () => {
      exited = true;
      resolve();
    }),
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.stdin.end();
      reject(Error("LOCK_TIMEOUT"));
    }, 5000);
    createInterface({ input: child.stdout }).once("line", (line) => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(line);
        if (
          result.status !== "LOCKED" ||
          !Array.isArray(result.identities) ||
          result.identities.length !== files.length
        )
          throw Error();
        identities = result.identities;
        resolve();
      } catch {
        reject(Error("LOCK_FAILED"));
      }
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
    identities,
    alive: () => !exited && !release,
    assertHeld: () => {
      if (exited || release) fail("WRITER_LOCK_LOST");
      for (const i of identities) {
        const st = fs.lstatSync(i.file, { bigint: true });
        if (
          !st.isFile() ||
          st.isSymbolicLink() ||
          String(st.dev) !== i.dev ||
          String(st.ino) !== i.ino ||
          Number(st.mode) !== i.mode ||
          Number(st.uid) !== i.uid
        )
          fail("LOCK_REPLACED");
      }
    },
    release: async () => {
      release = true;
      child.stdin.end();
      if (!exited) {
        let timer;
        try {
          await Promise.race([
            exitPromise,
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(Error("LOCK_RELEASE_TIMEOUT")),
                3000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
    },
  };
}
export function parseProcessLine(line) {
  const m = line
    .trim()
    .match(/^(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.*)$/);
  if (!m || !Number.isFinite(Date.parse(m[3] + " UTC")))
    fail("PROCESS_ROW_UNPARSEABLE");
  return {
    pid: +m[1],
    ppid: +m[2],
    started: Date.parse(m[3] + " UTC"),
    command: m[4],
  };
}
export async function processes() {
  const out = await command(
    "/bin/ps",
    ["-axo", "pid=,ppid=,lstart=,command="],
    { env: { ...environment(), TZ: "UTC" } },
  );
  return out
    .split("\n")
    .filter((line) => line.trim())
    .map(parseProcessLine);
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
