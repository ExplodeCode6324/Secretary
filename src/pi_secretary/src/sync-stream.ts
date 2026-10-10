import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApplicationService } from "./application-service.ts";
import { ApiError } from "./api/protocol.ts";
import { SYNC_BYTES } from "./sync-service.ts";
const active = new WeakMap<ApplicationService, number>();
const diagnostics = new WeakMap<
  ApplicationService,
  { slow_closes: number; peak_buffer_bytes: number }
>();
export const streamStats = (service: ApplicationService) => ({
  ...(diagnostics.get(service) ?? { slow_closes: 0, peak_buffer_bytes: 0 }),
  active: active.get(service) ?? 0,
});
export async function openSyncStream(
  service: ApplicationService,
  req: IncomingMessage,
  res: ServerResponse,
  q: URLSearchParams,
  binding?: string,
) {
  for (const key of q.keys())
    if (!["after", "thinking"].includes(key) || q.getAll(key).length !== 1)
      throw new ApiError("INVALID_QUERY");
  if (q.has("thinking") && !["true", "false"].includes(q.get("thinking")!))
    throw new ApiError("INVALID_QUERY");
  const header = req.headers["last-event-id"];
  if (Array.isArray(header)) throw new ApiError("INVALID_SYNC_CURSOR");
  if (header && q.get("after") && header !== q.get("after"))
    throw new ApiError("SYNC_CURSOR_CONFLICT");
  let after = q.get("after") ?? header;
  if (!after) throw new ApiError("SYNC_CURSOR_REQUIRED");
  const sync = service.synchronization;
  const client = sync.notifications.authenticate(
    binding,
    service.identity.owner_id,
  );
  sync.changes(after, client); // Validate before opening the response.
  if ((active.get(service) ?? 0) >= 32)
    throw new ApiError("SYNC_CONNECTION_LIMIT", 503);
  active.set(service, (active.get(service) ?? 0) + 1);
  const stats = diagnostics.get(service) ?? {
    slow_closes: 0,
    peak_buffer_bytes: 0,
  };
  diagnostics.set(service, stats);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  const abort = new AbortController();
  res.once("close", () => abort.abort());
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      if (abort.signal.aborted) return resolve();
      const done = () => {
        clearTimeout(timer);
        abort.signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      abort.signal.addEventListener("abort", done, { once: true });
    });
  const write = async (data: string) => {
    if (abort.signal.aborted) return false;
    if (Buffer.byteLength(data) + res.writableLength > SYNC_BYTES) {
      stats.slow_closes++;
      res.destroy();
      return false;
    }
    stats.peak_buffer_bytes = Math.max(
      stats.peak_buffer_bytes,
      Buffer.byteLength(data) + res.writableLength,
    );
    if (res.write(data)) return true;
    return new Promise<boolean>((resolve) => {
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        res.off("drain", drain);
        abort.signal.removeEventListener("abort", closed);
        resolve(ok);
      };
      const drain = () => finish(true),
        closed = () => finish(false);
      const timer = setTimeout(() => {
        stats.slow_closes++;
        res.destroy();
        finish(false);
      }, 5000);
      res.once("drain", drain);
      abort.signal.addEventListener("abort", closed, { once: true });
    });
  };
  let page: string | undefined,
    heartbeat = Date.now(),
    preview = -1,
    activity = "";
  try {
    while (!abort.signal.aborted) {
      sync.notifications.authenticate(binding, service.identity.owner_id);
      const result = sync.changes(after, client, page);
      for (const batch of result.batches) {
        if (
          !(await write(
            (batch.cursor ? "id: " + batch.cursor + "\n" : "") +
              "event: change\ndata: " +
              JSON.stringify(batch) +
              "\n\n",
          ))
        )
          return;
      }
      after = result.next_cursor;
      page = result.next_page ?? undefined;
      const previews = service.app.host.previews;
      const activities = service.app.activitySnapshot();
      const activityVersion = String(activities.activity_revision);
      if (previews.revision !== preview || activityVersion !== activity) {
        preview = previews.revision;
        activity = activityVersion;
        const payload = {
          instance_id: service.instanceID,
          preview_revision: String(preview),
          activity_revision: String(activities.activity_revision),
          previews: previews.snapshot(
            service.app.host.sessionID,
            q.get("thinking") === "true",
          ),
          activities,
          truncated: false,
        };
        // Display snapshots are disposable; never block persistent catch-up behind them.
        while (
          payload.previews.length &&
          Buffer.byteLength(JSON.stringify(payload)) > 128 * 1024
        ) {
          payload.previews.pop();
          payload.truncated = true;
        }
        if (
          Buffer.byteLength(JSON.stringify(payload)) <= 256 * 1024 &&
          !(await write(
            "event: transient\ndata: " + JSON.stringify(payload) + "\n\n",
          ))
        )
          return;
      }
      if (Date.now() - heartbeat >= 5000) {
        heartbeat = Date.now();
        if (!(await write(": heartbeat\n\n"))) return;
      }
      if (!result.has_more) await wait(100);
      else await wait(0); // Yield to writers and other connections during backlog.
    }
  } catch (e) {
    const code = e instanceof ApiError ? e.code : "SYNC_UNAVAILABLE";
    await write(
      "event: control\ndata: " +
        JSON.stringify({ code, action: "bootstrap" }) +
        "\n\n",
    );
    res.end();
  } finally {
    active.set(service, Math.max(0, (active.get(service) ?? 1) - 1));
  }
}
