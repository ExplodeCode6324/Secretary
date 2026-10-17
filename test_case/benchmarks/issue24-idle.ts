import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { Store } from "../../src/pi_secretary/src/store.ts";
const dir = process.argv[2];
if (!dir?.includes("issue24") || fs.existsSync(dir))
  throw Error("Fresh issue24 directory required");
const store = await Store.open(dir);
try {
  const owner = (store as any).owner;
  const pid = owner.childPID ?? owner.child?.pid;
  const time = () => {
    const value = execFileSync("ps", ["-p", String(pid), "-o", "time="], {
      encoding: "utf8",
    }).trim();
    const parts = value.split(":").map(Number);
    return parts.reduce((n, p) => n * 60 + p, 0) * 1000;
  };
  const warmupSeconds = Number(process.argv[3] ?? 0);
  if (warmupSeconds)
    await new Promise((r) => setTimeout(r, warmupSeconds * 1000));
  const before = time(),
    cpu = process.cpuUsage();
  const seconds = Number(process.argv[4] ?? 60);
  const intervals: number[] = [];
  let checkpoint = process.cpuUsage();
  for (let n = 0; n < seconds / 10; n++) {
    await new Promise((r) => setTimeout(r, 10000));
    const delta = process.cpuUsage(checkpoint);
    intervals.push((delta.user + delta.system) / 1000);
    checkpoint = process.cpuUsage();
  }
  const usage = process.cpuUsage(cpu);
  console.log(
    JSON.stringify({
      seconds,
      warmupSeconds,
      nodeIntervalsMs: intervals,
      helperCpuMs: time() - before,
      nodeCpuMs: (usage.user + usage.system) / 1000,
    }),
  );
} finally {
  await store.close();
}
