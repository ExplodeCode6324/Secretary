import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError, project } from "./api/protocol.ts";
import type { SyncService } from "./sync-service.ts";

export const STREAM_BYTES = 512 * 1024,
  STREAM_DRAIN_MS = 5000,
  STREAM_LIMIT = 8;
/** Durable events are pulled from Store; transient state is sampled and coalesced. */
export class SyncStreams {
  private connections = new Set<ServerResponse>();
  peakWritableBytes = 0;
  get active() {
    return this.connections.size;
  }
  close() {
    for (const res of this.connections) res.destroy();
  }
  async open(
    sync: SyncService,
    req: IncomingMessage,
    res: ServerResponse,
    q: URLSearchParams,
  ) {
    for (const key of q.keys())
      if (key !== "after" || q.getAll(key).length !== 1)
        throw new ApiError("INVALID_QUERY");
    const header = req.headers["last-event-id"];
    if (Array.isArray(header)) throw new ApiError("INVALID_QUERY");
    const after = q.get("after");
    if (after && header && after !== header)
      throw new ApiError("INVALID_QUERY");
    let cursor = after ?? header;
    if (!cursor) throw new ApiError("INVALID_QUERY");
    sync.position(cursor);
    if (this.active >= STREAM_LIMIT) throw new ApiError("BUSY", 503);
    this.connections.add(res);
    let ended = false,
      wake: (() => void) | undefined;
    const close = () => {
      ended = true;
      wake?.();
    };
    res.on("close", close);
    res.on("error", close);
    const wait = (ms: number, drain = false) =>
      new Promise<boolean>((resolve) => {
        const finish = (ok: boolean) => {
          clearTimeout(timer);
          res.off("drain", ready);
          wake = undefined;
          resolve(ok);
        };
        const ready = () => finish(true),
          timer = setTimeout(() => finish(!drain), ms);
        wake = () => finish(false);
        if (drain) res.once("drain", ready);
        if (ended) finish(false);
      });
    const write = async (text: string) => {
      const bytes = Buffer.byteLength(text);
      if (ended || bytes + res.writableLength > STREAM_BYTES) return false;
      const accepted = res.write(text);
      this.peakWritableBytes = Math.max(
        this.peakWritableBytes,
        res.writableLength,
      );
      if (!accepted && !(await wait(STREAM_DRAIN_MS, true))) return false;
      return !ended;
    };
    let heartbeat = Date.now(),
      transient = "";
    try {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        Connection: "keep-alive",
      });
      res.flushHeaders();
      while (!ended) {
        // At most four complete transactions before sampling transient state/heartbeat.
        const page = sync.changes(cursor, 4);
        for (const tx of page.transactions) {
          if (
            !(await write(
              `event: change\nid: ${tx.cursor}\ndata: ${JSON.stringify(tx)}\n\n`,
            ))
          )
            return;
          cursor = tx.cursor;
        }
        if (Date.now() - heartbeat >= 5000) {
          if (!(await write(": heartbeat\n\n"))) return;
          heartbeat = Date.now();
        }
        const state = JSON.stringify({
          previews: sync.app.host.previews.snapshot(
            sync.app.host.sessionID,
            false,
          ),
          activities: project(sync.app.activitySnapshot()),
        });
        if (state !== transient) {
          // A transient may exceed the connection budget; drop it and retain durable recovery.
          if (
            Buffer.byteLength(state) < STREAM_BYTES / 2 &&
            !(await write(`event: transient\ndata: ${state}\n\n`))
          )
            return;
          transient = state;
        }
        await wait(page.has_more ? 0 : 100);
      }
    } finally {
      this.connections.delete(res);
      res.off("close", close);
      res.off("error", close);
      res.destroy();
    }
  }
}
