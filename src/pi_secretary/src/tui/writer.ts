import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
export type BlobRef = {
  blob: string;
  sha256: string;
  bytes: number;
  created_at: string;
  kind?: "receipt";
};
export type BlobWrite = { ref: BlobRef; base64: string };
export function blobOf(
  text: string,
  id: string = randomUUID(),
  created = new Date().toISOString(),
): BlobWrite {
  const body = Buffer.from(text, "utf8");
  if (body.toString("utf8") !== text) throw Error("INVALID_UTF8");
  return {
    ref: {
      blob: id,
      sha256: createHash("sha256").update(body).digest("hex"),
      bytes: body.length,
      created_at: created,
    },
    base64: body.toString("base64"),
  };
}
export const writerPath = fileURLToPath(
  new URL("./writer.py", import.meta.url),
);
export function pythonReady(): void {
  if (!["darwin", "linux"].includes(process.platform))
    throw Error("UNSUPPORTED_PLATFORM");
  if (process.platform === "darwin") {
    const clt = spawnSync("/usr/bin/xcode-select", ["-p"], {
      encoding: "utf8",
      timeout: 1000,
    });
    if (clt.status !== 0 || !existsSync(`${clt.stdout.trim()}/usr/bin/python3`))
      throw Error("PYTHON_PREREQUISITE: no install attempted");
  }
  const check = spawnSync(
    "/usr/bin/python3",
    ["-c", "import fcntl,sys;assert sys.version_info.major==3"],
    { timeout: 3000 },
  );
  if (check.status !== 0)
    throw Error("PYTHON_PREREQUISITE: requires /usr/bin/python3 and fcntl");
}
type Reply = { id: number; error?: string; [key: string]: unknown };
export type CommitIntent = "maintenance" | "input-ack";
type Job = {
  queuedAt: number;
  intent: CommitIntent;
  bypassUsed: boolean;
  request: Record<string, unknown>;
  resolve: (reply: Reply) => void;
  reject: (error: Error) => void;
};
export class StateWriter {
  readonly child: ChildProcessWithoutNullStreams;
  readonly ready: Promise<void>;
  sequence = 0;
  data: unknown = null;
  usage = 0;
  qos: unknown;
  private serial = 0;
  private current?: Job & { id: number };
  private operationTimer?: ReturnType<typeof setTimeout>;
  private abortWriter!: (error: Error) => void;
  private high: Job[] = [];
  private low?: Job;
  private lowDispatch?: ReturnType<typeof setImmediate>;
  private failed?: Error;
  private closed = false;
  private incoming = Buffer.alloc(0);
  private readonly now: () => number;
  get healthy() {
    return !this.failed && !this.closed;
  }
  get checkpointQueue() {
    return this.low ? 1 : 0;
  }
  constructor(
    root: string,
    quota = 256 * 1024 * 1024,
    options: { helperPath?: string; now?: () => number } = {},
  ) {
    this.now = options.now ?? (() => performance.now());
    pythonReady();
    this.child = spawn(
      "/usr/bin/python3",
      [options.helperPath ?? writerPath, root, String(quota)],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          PATH: "/usr/bin:/bin",
          LANG: "C.UTF-8",
          PYTHONUTF8: "1",
          PYTHONUNBUFFERED: "1",
        },
      },
    );
    let startupResolve!: () => void, startupReject!: (error: Error) => void;
    this.ready = new Promise((resolve, reject) => {
      startupResolve = resolve;
      startupReject = reject;
    });
    const timer = setTimeout(() => fail(Error("WRITER_READY_TIMEOUT")), 10000);
    let stderr = "";
    let started = false;
    const fail = (error: Error) => {
      if (this.failed) return;
      this.failed = error;
      clearTimeout(timer);
      startupReject(error);
      clearTimeout(this.operationTimer);
      this.current?.reject(error);
      this.current = undefined;
      for (const job of this.high.splice(0)) job.reject(error);
      this.low?.reject(error);
      this.low = undefined;
      this.child.stdin.end();
    };
    this.abortWriter = fail;
    this.child.stderr.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-2048);
    });
    this.child.once("error", fail);
    this.child.stdin.on("error", fail);
    this.child.once("exit", (code, signal) =>
      fail(
        Error(
          code === 73
            ? "TUI_ALREADY_RUNNING"
            : `WRITER_EXIT:${code}/${signal}:${stderr}`,
        ),
      ),
    );
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.incoming = Buffer.concat([this.incoming, chunk]);
      if (this.incoming.length > 16 * 1024 * 1024)
        return fail(Error("WRITER_REPLY_BOUND"));
      let line: number;
      while ((line = this.incoming.indexOf(10)) >= 0) {
        const text = this.incoming.subarray(0, line).toString("utf8");
        this.incoming = this.incoming.subarray(line + 1);
        try {
          const reply = JSON.parse(text);
          if (reply.ready === true && !this.current && !started) {
            if (
              !reply.manifest ||
              !Number.isSafeInteger(reply.manifest.sequence)
            )
              throw Error("INVALID_WRITER_READY");
            this.sequence = reply.manifest.sequence;
            this.data = reply.manifest.data;
            this.usage = reply.usage;
            this.qos = reply.qos;
            clearTimeout(timer);
            startupResolve();
            started = true;
          } else {
            const job = this.current;
            if (!job || reply.id !== job.id) throw Error("INVALID_WRITER_ACK");
            clearTimeout(this.operationTimer);
            this.current = undefined;
            if (reply.error) {
              job.reject(Error(reply.error));
              if (job.request.op === "commit" || job.request.op === "read")
                fail(Error(reply.error));
              else this.dispatch();
            } else {
              if (job.request.op === "commit") {
                if (reply.sequence !== this.sequence + 1)
                  throw Error("INVALID_COMMIT_SEQUENCE");
                this.sequence = reply.sequence;
                this.data = job.request.data;
                this.usage = reply.usage;
              }
              job.resolve(reply);
              this.dispatch();
            }
          }
        } catch (error) {
          fail(error instanceof Error ? error : Error("INVALID_WRITER_REPLY"));
        }
      }
    });
  }
  private dispatch(allowLow = false) {
    if (this.current || !this.healthy) return;
    if (!this.high.length && this.low && !allowLow) {
      // ACK consumers may have already queued business transactions on a
      // Promise chain. Let those continuations expose their high-priority jobs.
      this.lowDispatch ??= setImmediate(() => {
        this.lowDispatch = undefined;
        this.dispatch(true);
      });
      return;
    }
    // A coalesced checkpoint keeps its original age. Bound starvation under
    // sustained business work so durable sync obligations can make progress.
    const lowDue = this.low && this.now() - this.low.queuedAt >= 250;
    const bypass =
      lowDue && !this.low!.bypassUsed && this.high[0]?.intent === "input-ack";
    if (bypass) this.low!.bypassUsed = true;
    const job = lowDue && !bypass ? this.low : (this.high.shift() ?? this.low);
    if (!job) return;
    if (job === this.low) this.low = undefined;
    this.current = { ...job, id: ++this.serial };
    const request: Record<string, unknown> = {
      ...job.request,
      id: this.serial,
    };
    if (request.op === "commit")
      Object.assign(request, { expected: this.sequence });
    const line = JSON.stringify(request) + "\n";
    if (Buffer.byteLength(line) > 48 * 1024 * 1024) {
      this.current = undefined;
      job.reject(Error("WRITER_REQUEST_BOUND"));
      this.dispatch();
      return;
    }
    this.child.stdin.write(line);
    this.operationTimer = setTimeout(
      () =>
        this.abortWriter(
          Error(
            "WRITER_OPERATION_TIMEOUT: durable outcome unknown; reopen for recovery",
          ),
        ),
      10000,
    );
  }
  private async request(
    request: Record<string, unknown>,
    low = false,
    intent: CommitIntent = "maintenance",
  ): Promise<Reply> {
    await this.ready;
    if (!this.healthy) throw this.failed ?? Error("WRITER_CLOSED");
    return new Promise((resolve, reject) => {
      const job = {
        request,
        resolve,
        reject,
        queuedAt: low && this.low ? this.low.queuedAt : this.now(),
        bypassUsed: low && this.low ? this.low.bypassUsed : false,
        intent,
      };
      if (low) {
        this.low?.reject(Error("CHECKPOINT_COALESCED"));
        this.low = job;
      } else {
        if (this.high.length >= 16) {
          reject(Error("WRITER_BACKPRESSURE"));
          return;
        }
        this.high.push(job);
      }
      this.dispatch();
    });
  }
  async commit(
    data: unknown,
    blobs: BlobWrite[] = [],
    retire: Record<string, "superseded" | "discard" | "handoff"> = {},
    intent: CommitIntent = "maintenance",
  ) {
    await this.request({ op: "commit", data, blobs, retire }, false, intent);
  }
  async read(ref: BlobRef): Promise<string> {
    const reply = await this.request({ op: "read", ref });
    const body = Buffer.from(String(reply.base64), "base64");
    if (
      body.length !== ref.bytes ||
      createHash("sha256").update(body).digest("hex") !== ref.sha256
    )
      throw Error("CORRUPT_BLOB");
    return new TextDecoder("utf8", { fatal: true }).decode(body);
  }
  async checkpoint(value: unknown, snapshot: unknown): Promise<void> {
    await this.request(
      {
        op: "checkpoint",
        value,
        snapshot: Buffer.from(JSON.stringify(snapshot)).toString("base64"),
      },
      true,
    );
  }
  async loadCheckpoint(): Promise<{ value: unknown; snapshot: unknown }> {
    const reply = await this.request({ op: "checkpoint-read" });
    return {
      value: reply.value,
      snapshot: reply.snapshot
        ? JSON.parse(
            Buffer.from(String(reply.snapshot), "base64").toString("utf8"),
          )
        : null,
    };
  }
  async collect() {
    return this.request({ op: "collect" });
  }
  async receipts(
    after = "",
  ): Promise<{ items: BlobRef[]; next: string | null }> {
    const reply = await this.request({ op: "receipts", after });
    return {
      items: reply.items as BlobRef[],
      next: reply.next as string | null,
    };
  }
  async flush(timeout = 2000): Promise<boolean> {
    const deadline = Date.now() + timeout;
    while (
      this.healthy &&
      (this.current || this.high.length || this.low) &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    return this.healthy && !this.current && !this.high.length && !this.low;
  }
  async close(): Promise<boolean> {
    const flushed = await this.flush();
    this.closed = true;
    this.child.stdin.end();
    return flushed;
  }
}
