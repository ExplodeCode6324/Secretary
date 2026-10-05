import * as fs from "node:fs";

type ProcessProbe = {
  platform?: NodeJS.Platform;
  signal?: (pid: number, signal: 0) => unknown;
  readStat?: (pid: number) => string;
};

// The backend is detached, so the test cannot await a ChildProcess exit event.
export function processHasExited(
  pid: number,
  probe: ProcessProbe = {},
): boolean {
  const signal = probe.signal ?? process.kill;
  try {
    signal(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
    throw error;
  }
  if ((probe.platform ?? process.platform) !== "linux") return false;
  try {
    const stat = (
      probe.readStat ?? ((pid) => fs.readFileSync(`/proc/${pid}/stat`, "utf8"))
    )(pid);
    // A container's PID 1 may not promptly reap an orphaned detached backend.
    // Z has exited even though kill(pid, 0) still succeeds. Parse after comm,
    // whose parenthesized value may itself contain spaces and parentheses.
    const state = stat
      .slice(stat.lastIndexOf(")") + 1)
      .trim()
      .split(/\s+/)[0];
    return state === "Z" || state === "X" || state === "x";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}
