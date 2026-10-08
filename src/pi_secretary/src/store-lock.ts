import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const TIMEOUT_MS = 30_000;
const pause = new Int32Array(new SharedArrayBuffer(4));
type Reply = { id: string; error?: string; digest?: string };

/**
 * Synchronous acknowledged transport to the only journal writer. Each open has
 * a fresh private mailbox; another owner can never consume its requests. The
 * mailbox is transport, not a lock: lock.py holds flock throughout every write.
 */
export class JournalOwner {
  private child: ChildProcess;
  private failed = false;
  private closed = false;
  private closing?: Promise<void>;
  private constructor(
    private readonly channel: string,
    dir: string,
  ) {
    this.child = spawn(
      "python3",
      [fileURLToPath(new URL("./lock.py", import.meta.url)), dir, channel],
      { stdio: ["pipe", "ignore", "ignore"] },
    );
    this.child.on("error", () => {
      this.failed = true;
    });
    this.child.on("exit", () => {
      this.failed = true;
    });
    this.child.stdin!.on("error", () => {
      this.failed = true;
    });
  }
  static async open(
    dir: string,
  ): Promise<{ owner: JournalOwner; replay: Buffer }> {
    const channel = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-owner-"));
    let owner: JournalOwner;
    try {
      owner = new JournalOwner(channel, dir);
    } catch (error) {
      fs.rmSync(channel, { recursive: true, force: true });
      throw error;
    }
    try {
      const deadline = performance.now() + TIMEOUT_MS;
      for (;;) {
        const reply = owner.readReply();
        if (reply) {
          if (reply.id !== "open") throw Error("STORE_NOT_OWNER");
          if (reply.error) throw Error(reply.error);
          const replay = fs.readFileSync(path.join(channel, "replay"));
          owner.assertOwner();
          return { owner, replay };
        }
        owner.assertOwner();
        if (performance.now() >= deadline) throw Error("STORE_NOT_OWNER");
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    } catch (error) {
      owner.failed = true;
      await owner.close();
      throw error;
    }
  }
  assertOwner() {
    // Only a fast rejection: delayed exit events cannot authorize an append.
    if (
      this.closed ||
      this.failed ||
      this.child.exitCode !== null ||
      this.child.signalCode !== null
    )
      throw Error("STORE_NOT_OWNER");
  }
  private readReply(): Reply | undefined {
    const file = path.join(this.channel, "response");
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    fs.unlinkSync(file);
    return JSON.parse(text) as Reply;
  }
  append(frame: string, digest: string) {
    this.assertOwner();
    const requestID = randomUUID();
    try {
      const temp = path.join(this.channel, "request.tmp");
      fs.writeFileSync(temp, JSON.stringify({ id: requestID, frame, digest }), {
        mode: 0o600,
      });
      fs.renameSync(temp, path.join(this.channel, "request"));
      const deadline = performance.now() + TIMEOUT_MS;
      for (;;) {
        const reply = this.readReply();
        if (reply) {
          if (reply.id !== requestID || reply.digest !== digest || reply.error)
            throw Error("STORE_NOT_OWNER");
          return;
        }
        this.assertOwner();
        if (performance.now() >= deadline) throw Error("STORE_NOT_OWNER");
        Atomics.wait(pause, 0, 0, 1);
      }
    } catch (error) {
      // Never retry or install an uncertain append. Late ACKs cannot restore
      // ownership; close/reopen must replay the durable state.
      this.failed = true;
      this.child.stdin!.destroy();
      throw Error("STORE_NOT_OWNER", { cause: error });
    }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = (async () => {
      await new Promise<void>((resolve, reject) => {
        if (
          this.child.exitCode !== null ||
          this.child.signalCode !== null ||
          !this.child.pid
        ) {
          resolve();
          return;
        }
        let forceTimer: ReturnType<typeof setTimeout> | undefined;
        const exited = () => {
          clearTimeout(graceTimer);
          clearTimeout(forceTimer);
          resolve();
        };
        const graceTimer = setTimeout(() => {
          this.child.kill("SIGKILL");
          forceTimer = setTimeout(() => {
            this.child.removeListener("exit", exited);
            // Keep the mailbox if termination cannot be confirmed. Do not
            // report successful close or claim the OS lock has been released.
            reject(Error("STORE_CLOSE_TIMEOUT"));
          }, 1_000);
        }, 1_000);
        this.child.once("exit", exited);
        this.child.stdin!.end();
      });
      fs.rmSync(this.channel, { recursive: true, force: true });
    })();
    return this.closing;
  }
}
