import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const TIMEOUT_MS = 30_000;
type Reply = { id: string; sequence: number; error?: string; digest: string };

/** Python alone holds flock and writes the journal. A worker drains its pipes
 * while the synchronous caller waits on one shared acknowledgement word. */
export class JournalOwner {
  private worker: Worker;
  private alive = new Int32Array(new SharedArrayBuffer(8));
  private failed = false;
  private closed = false;
  private exited = false;
  private workerExited = false;
  private abortSent = false;
  private killSent = false;
  private closing?: Promise<void>;
  private childPID?: number;
  private sequence = 0;
  private digest = "0".repeat(64);
  private reply = new SharedArrayBuffer(4104);
  private constructor(
    private readonly channel: string,
    dir: string,
    private readonly timeoutMs: number,
    helperPath: string,
  ) {
    this.worker = new Worker(new URL("./store-channel.mjs", import.meta.url), {
      execArgv: [],
      workerData: {
        channel,
        dir,
        helper: helperPath,
        alive: this.alive.buffer,
      },
    });
    this.worker.on("message", (message) => {
      if (message.kind === "pid") this.childPID = message.pid;
      if (message.kind === "exited") this.exited = true;
      if (message.kind === "failure") this.failed = true;
    });
    this.worker.on("error", () => this.invalidate());
    this.worker.on("exit", () => {
      this.workerExited = true;
      this.invalidate();
    });
  }
  // Options are an internal construction seam for deterministic protocol tests.
  static async open(
    dir: string,
    options: { timeoutMs?: number; helperPath?: string } = {},
  ): Promise<{ owner: JournalOwner; replay: Buffer }> {
    const channel = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-owner-"));
    const owner = new JournalOwner(
      channel,
      dir,
      options.timeoutMs ?? TIMEOUT_MS,
      options.helperPath ??
        fileURLToPath(new URL("./lock.py", import.meta.url)),
    );
    try {
      const reply = await new Promise<Reply>((resolve, reject) => {
        const finish = (error?: Error, reply?: Reply) => {
          clearTimeout(timer);
          owner.worker.off("message", message);
          owner.worker.off("error", failed);
          owner.worker.off("exit", failed);
          if (error) reject(error);
          else resolve(reply!);
        };
        const failed = () => finish(Error("STORE_NOT_OWNER"));
        const message = (value: any) => {
          if (value.kind === "ready") finish(undefined, value.reply);
          if (value.kind === "failure") finish(Error(value.error));
        };
        const timer = setTimeout(failed, owner.timeoutMs);
        owner.worker.on("message", message);
        owner.worker.once("error", failed);
        owner.worker.once("exit", failed);
      });
      owner.sequence = reply.sequence;
      owner.digest = reply.digest;
      const replay = fs.readFileSync(path.join(channel, "replay"));
      fs.unlinkSync(path.join(channel, "replay"));
      owner.assertOwner();
      return { owner, replay };
    } catch (error) {
      owner.invalidate();
      await owner.close();
      throw error;
    }
  }
  verifyReplay(sequence: number, digest: string) {
    if (this.sequence !== sequence || this.digest !== digest) {
      this.invalidate();
      throw Error("CORRUPT_JOURNAL");
    }
  }
  assertOwner() {
    if (this.closed || this.failed || Atomics.load(this.alive, 0) !== 1)
      throw Error("STORE_NOT_OWNER");
  }
  private invalidate() {
    this.failed = true;
    Atomics.store(this.alive, 0, 0);
    if (!this.workerExited) {
      if (!this.abortSent) {
        this.abortSent = true;
        this.worker.postMessage({ kind: "abort" });
      }
    } else if (
      this.childPID &&
      !this.exited &&
      !Atomics.load(this.alive, 1) &&
      !this.killSent
    ) {
      // Only a dead worker requires the parent to terminate its orphan helper.
      // The shared exit flag avoids acting on an already reaped child PID.
      this.killSent = true;
      try {
        process.kill(this.childPID, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
  }

  private readReply(): Reply {
    const state = new Int32Array(this.reply, 0, 2);
    return JSON.parse(
      Buffer.from(this.reply, 8, Atomics.load(state, 1)).toString(),
    );
  }
  append(frame: string, digest: string) {
    this.assertOwner();
    const id = randomUUID(),
      sequence = this.sequence + 1;
    const state = new Int32Array(this.reply, 0, 2);
    Atomics.store(state, 0, 0);
    try {
      this.worker.postMessage({
        kind: "append",
        id,
        sequence,
        frame,
        digest,
        reply: this.reply,
      });
      const deadline = performance.now() + this.timeoutMs;
      while (Atomics.load(state, 0) === 0) {
        const remaining = deadline - performance.now();
        if (remaining <= 0) throw Error("ACK_TIMEOUT");
        Atomics.wait(state, 0, 0, remaining);
      }
      this.assertOwner();
      if (Atomics.load(state, 0) !== 1) throw Error("INVALID_ACK");
      const reply = this.readReply();
      if (
        reply.id !== id ||
        reply.sequence !== sequence ||
        reply.digest !== digest ||
        reply.error
      )
        throw Error("INVALID_ACK");
      this.sequence = sequence;
      this.digest = digest;
    } catch (error) {
      // An uncertain append is never retried or installed. Only reopen/replay
      // can establish durable state; a late ACK cannot revive this owner.
      this.invalidate();
      throw Error("STORE_NOT_OWNER", { cause: error });
    }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = (async () => {
      this.worker.postMessage({ kind: "close" });
      const deadline = performance.now() + 2000;
      while (!this.exited) {
        if (this.childPID) {
          try {
            process.kill(this.childPID, 0);
            // A terminated Worker cannot deliver its ChildProcess exit event.
            // POSIX zombies have exited and released flock, although kill(0)
            // still succeeds until the parent runtime reaps them.
            if (this.workerExited) {
              const state = execFileSync(
                "ps",
                ["-p", String(this.childPID), "-o", "stat="],
                { encoding: "utf8", timeout: 1000 },
              ).trim();
              if (state.startsWith("Z")) break;
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH") break;
            // ps may race with the runtime reaping an exited child.
            try {
              process.kill(this.childPID, 0);
            } catch (probe) {
              if ((probe as NodeJS.ErrnoException).code === "ESRCH") break;
            }
            throw error;
          }
        } else if (this.workerExited) break;
        if (performance.now() >= deadline) throw Error("STORE_CLOSE_TIMEOUT");
        if (this.failed || performance.now() >= deadline - 1000)
          this.invalidate();
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await this.worker.terminate();
      fs.rmSync(this.channel, { recursive: true, force: true });
    })();
    return this.closing;
  }
}
