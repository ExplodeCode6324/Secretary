import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { Trace } from "./terminal.ts";

export const helperPath = fileURLToPath(
  new URL("./writer.py", import.meta.url),
);
export function pythonPrerequisite(): string {
  if (process.platform !== "darwin" && process.platform !== "linux")
    throw new Error("G0 supports macOS/Linux POSIX only");
  if (process.platform === "darwin") {
    const clt = spawnSync("/usr/bin/xcode-select", ["-p"], {
      timeout: 1000,
      encoding: "utf8",
    });
    if (clt.status !== 0 || !existsSync(`${clt.stdout.trim()}/usr/bin/python3`))
      throw new Error(
        "CLT Python prerequisite unavailable; no install attempted",
      );
  } else if (!existsSync("/usr/bin/python3")) {
    throw new Error(
      "Linux requires /usr/bin/python3 with fcntl; no install attempted",
    );
  }
  const python = spawnSync(
    "/usr/bin/python3",
    ["-c", "import sys,fcntl;print(sys.version)"],
    { timeout: 3000, encoding: "utf8" },
  );
  if (python.status !== 0)
    throw new Error(
      `Python prerequisite failed: ${python.error?.message ?? python.stderr}`,
    );
  return python.stdout.trim();
}

/** Single in-flight snapshot plus one coalesced pending snapshot. G0 only. */
export class ProbeWriter {
  readonly child: ChildProcessWithoutNullStreams;
  private seq = 0;
  private sent = 0;
  private ack = 0;
  private pending?: { seq: number; value: unknown; delay_ms: number };
  private failed?: string;
  readonly ready: Promise<void>;
  constructor(
    root: string,
    private readonly trace: Trace,
  ) {
    this.child = spawn("/usr/bin/python3", [helperPath, root], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: "/usr/bin:/bin",
        LANG: process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8",
        PYTHONUTF8: "1",
        PYTHONUNBUFFERED: "1",
      },
    });
    this.child.stdin.on("error", (error) => {
      this.failed = error.message;
      trace("helper-pipe-error", error.message);
    });
    this.child.stderr.on("data", (data) =>
      trace("helper-stderr", String(data).slice(0, 4096)),
    );
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("helper READY timeout")),
        1500,
      );
      this.child.once("error", (error) => {
        clearTimeout(timer);
        this.failed = error.message;
        reject(error);
      });
      this.child.once("exit", (code, signal) => {
        clearTimeout(timer);
        this.failed = `helper exited ${code}/${signal}`;
        trace("helper-exit", { code, signal, ack: this.ack, queued: this.seq });
        reject(new Error(this.failed));
      });
      createInterface({ input: this.child.stdout }).on("line", (line) => {
        try {
          const reply = JSON.parse(line);
          trace("helper-reply", reply);
          if (reply.ready) {
            clearTimeout(timer);
            resolve();
          } else if (reply.saved && reply.seq === this.sent) {
            this.ack = reply.seq;
            this.dispatch();
          } else this.failed = reply.error ?? "unexpected helper ACK";
        } catch {
          this.failed = "malformed helper ACK";
        }
      });
    });
  }
  save(value: unknown, delay_ms = 0): number {
    if (this.failed) throw new Error(this.failed);
    const request = { seq: ++this.seq, value, delay_ms };
    if (Buffer.byteLength(JSON.stringify(request) + "\n") > 65536)
      throw new Error("G0 snapshot exceeds 64 KiB");
    this.pending = request;
    this.dispatch();
    return request.seq;
  }
  private dispatch(): void {
    if (!this.pending || this.sent !== this.ack || this.failed) return;
    const request = this.pending;
    this.pending = undefined;
    this.sent = request.seq;
    this.trace("save-dispatched", { seq: request.seq });
    this.child.stdin.write(JSON.stringify(request) + "\n");
  }
  async flush(maxMs = 2000): Promise<boolean> {
    const end = Date.now() + maxMs;
    while (!this.failed && this.ack !== this.seq && Date.now() < end)
      await new Promise((resolve) => setTimeout(resolve, 10));
    return !this.failed && this.ack === this.seq;
  }
  close(): void {
    this.child.stdin.end();
  }
}
