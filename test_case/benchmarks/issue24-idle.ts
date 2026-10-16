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
  const before = time(),
    cpu = process.cpuUsage();
  await new Promise((r) => setTimeout(r, 60000));
  const usage = process.cpuUsage(cpu);
  console.log(
    JSON.stringify({
      seconds: 60,
      helperCpuMs: time() - before,
      nodeCpuMs: (usage.user + usage.system) / 1000,
    }),
  );
} finally {
  await store.close();
}
