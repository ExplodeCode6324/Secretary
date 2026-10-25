import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { CoreEndpoint } from "./api-v1.ts";
import type {
  Core,
  Receipt,
  Assistant,
  SyncCursor,
  SyncPage,
  NotificationPage,
  Notification,
} from "./api/contracts.ts";
export type RequestOptions = {
  signal?: AbortSignal;
  maxBytes?: number;
  timeoutMs?: number;
};
/** A missing route/receipt is authoritative only with its status AND valid v1 envelope. */
export class CoreTransportError extends Error {
  constructor(
    readonly code: string,
    readonly route: string,
    readonly status: number | null = null,
    readonly envelopeValid = false,
    readonly networkKind: "abort" | "timeout" | "network" | null = null,
  ) {
    super(code);
  }
}
export async function boundedBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw Error("INVALID_RESPONSE_BOUND");
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw Error("RESPONSE_TOO_LARGE");
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export class CoreClient {
  constructor(readonly endpoint: CoreEndpoint) {}
  async query<T = unknown>(
    route: string,
    options: RequestOptions = {},
  ): Promise<T> {
    return this.request<T>("GET", route, undefined, options);
  }
  async command(
    route: string,
    body: { request_id: string; [key: string]: unknown },
    options: RequestOptions = {},
  ): Promise<Receipt> {
    return this.request<Receipt>("POST", route, JSON.stringify(body), options);
  }
  async commandFrozen(
    route: string,
    bytes: string,
    requestID: string,
    sha256: string,
    options: RequestOptions = {},
  ): Promise<Receipt> {
    if (
      Buffer.byteLength(bytes) > 1048576 ||
      createHash("sha256").update(bytes).digest("hex") !== sha256
    )
      throw new CoreTransportError("INVALID_FROZEN_BODY", route);
    let body: unknown;
    try {
      body = JSON.parse(bytes);
    } catch {
      throw new CoreTransportError("INVALID_FROZEN_BODY", route);
    }
    if (
      !body ||
      typeof body !== "object" ||
      (body as { request_id?: unknown }).request_id !== requestID
    )
      throw new CoreTransportError("INVALID_FROZEN_BODY", route);
    return this.request<Receipt>("POST", route, bytes, options);
  }
  async attachmentContent(attachmentID: string) {
    if (!/^[a-f0-9-]{36}$/i.test(attachmentID)) throw Error("INVALID_ROUTE");
    const response = await fetch(
      this.endpoint.url + "/api/v1/attachments/" + attachmentID + "/content",
      {
        headers: {
          Authorization: `Bearer ${this.endpoint.token}`,
          "X-Secretary-API-Version": "1",
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok)
      throw Error(
        ((await response.json()) as { error?: { code: string } }).error?.code ??
          "CORE_REQUEST_FAILED",
      );
    return Buffer.from(await response.arrayBuffer());
  }
  core() {
    return this.query<Core>("core");
  }
  assistant() {
    return this.query<Assistant>("assistant");
  }
  syncCursor() {
    return this.query<SyncCursor>("sync/cursor");
  }
  changes(after: string, limit = 100) {
    return this.query<SyncPage>(
      "sync/changes?" + new URLSearchParams({ after, limit: String(limit) }),
    );
  }
  notifications(cursor?: string) {
    return this.query<NotificationPage>(
      "notifications" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
    );
  }
  notification(notificationID: string) {
    return this.query<Notification>("notifications/" + notificationID);
  }
  async stream(after: string, signal: AbortSignal) {
    try {
      const response = await fetch(this.endpoint.url + "/api/v1/sync/stream", {
        headers: {
          Authorization: `Bearer ${this.endpoint.token}`,
          "X-Secretary-API-Version": "1",
          "Last-Event-ID": after,
        },
        signal,
      });
      if (!response.ok) await this.decode(response, "sync/stream", 65536);
      if (
        !response.headers
          .get("content-type")
          ?.startsWith("text/event-stream") ||
        !response.body
      )
        throw new CoreTransportError(
          "MALFORMED_STREAM",
          "sync/stream",
          response.status,
        );
      return response.body!;
    } catch (error) {
      if (error instanceof CoreTransportError) throw error;
      throw new CoreTransportError(
        "CORE_UNREACHABLE",
        "sync/stream",
        null,
        false,
        signal.aborted
          ? signal.reason?.name === "TimeoutError"
            ? "timeout"
            : "abort"
          : "network",
      );
    }
  }
  private async decode<T>(
    response: Response,
    route: string,
    maxBytes: number,
  ): Promise<T> {
    let result: { api_version?: unknown; data?: T; error?: { code?: unknown } };
    try {
      const bytes = await boundedBytes(response, maxBytes);
      result = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        ["AbortError", "TimeoutError"].includes(error.name)
      )
        throw error;
      throw new CoreTransportError(
        error instanceof Error && error.message === "RESPONSE_TOO_LARGE"
          ? error.message
          : "MALFORMED_RESPONSE",
        route,
        response.status,
      );
    }
    const valid =
      !!result && typeof result === "object" && result.api_version === "1";
    if (!valid)
      throw new CoreTransportError(
        "MALFORMED_RESPONSE",
        route,
        response.status,
      );
    if (!response.ok)
      throw new CoreTransportError(
        typeof result.error?.code === "string"
          ? result.error.code
          : "MALFORMED_RESPONSE",
        route,
        response.status,
        typeof result.error?.code === "string",
      );
    if (!("data" in result))
      throw new CoreTransportError(
        "MALFORMED_RESPONSE",
        route,
        response.status,
      );
    return result.data as T;
  }
  private async request<T>(
    method: string,
    route: string,
    body?: string,
    options: RequestOptions = {},
  ): Promise<T> {
    if (!/^[a-z][a-z0-9/?=&%_.:-]*$/i.test(route))
      throw new CoreTransportError("INVALID_ROUTE", route);
    const signal = AbortSignal.any([
      AbortSignal.timeout(options.timeoutMs ?? 10000),
      ...(options.signal ? [options.signal] : []),
    ]);
    try {
      const r = await fetch(this.endpoint.url + "/api/v1/" + route, {
        method,
        headers: {
          Authorization: `Bearer ${this.endpoint.token}`,
          "Content-Type": "application/json",
          "X-Secretary-API-Version": "1",
        },
        body,
        signal,
      });
      const data = await this.decode<T>(r, route, options.maxBytes ?? 1048576);
      if (r.status !== (method === "POST" ? 202 : 200))
        throw new CoreTransportError(
          "UNEXPECTED_STATUS",
          route,
          r.status,
          true,
        );
      return data;
    } catch (error) {
      if (error instanceof CoreTransportError) throw error;
      const kind = signal.aborted
        ? signal.reason?.name === "TimeoutError"
          ? "timeout"
          : "abort"
        : "network";
      throw new CoreTransportError(
        "CORE_UNREACHABLE",
        route,
        null,
        false,
        kind,
      );
    }
  }
}

export type AttachmentStatus =
  | "ATTACHED"
  | "STOPPED"
  | "UNREACHABLE"
  | "UNSAFE"
  | "IDENTITY_MISMATCH"
  | "MODE_MISMATCH";
export type CoreAttachment = {
  status: AttachmentStatus;
  client?: CoreClient;
  core?: Core;
  detail: string;
};
/** Explicit profile/mode, attach only. Reads no Core lock, journal, settings or provider keys. */
export async function inspectCore(
  directory: string,
  mode: "fixture" | "live",
  signal?: AbortSignal,
): Promise<CoreAttachment> {
  const fail = (status: AttachmentStatus, detail = status): CoreAttachment => ({
    status,
    detail,
  });
  if (!path.isAbsolute(directory)) return fail("UNSAFE");
  let endpoint: CoreEndpoint;
  try {
    const file = path.join(directory, "core-endpoint.json");
    const fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      const stat = fs.fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.uid !== process.getuid?.() ||
        stat.mode & 0o077 ||
        stat.size > 16384
      )
        return fail("UNSAFE");
      endpoint = JSON.parse(fs.readFileSync(fd, "utf8"));
    } finally {
      fs.closeSync(fd);
    }
    if (
      endpoint.api_version !== "1" ||
      !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint.url) ||
      !/^[a-f0-9]{64}$/.test(endpoint.token) ||
      typeof endpoint.instance_id !== "string" ||
      typeof endpoint.data_domain_id !== "string"
    )
      return fail("UNSAFE");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? fail("STOPPED")
      : fail("UNSAFE");
  }
  const client = new CoreClient(endpoint);
  try {
    const core = await client.query<Core>("core", { signal });
    if (
      !core ||
      core.api_version !== "1" ||
      core.instance_id !== endpoint.instance_id ||
      core.data_domain_id !== endpoint.data_domain_id
    )
      return fail("IDENTITY_MISMATCH");
    if (core.mode !== mode) return fail("MODE_MISMATCH");
    return { status: "ATTACHED", client, core, detail: "ATTACHED" };
  } catch {
    return fail("UNREACHABLE");
  }
}
export async function attachCore(
  directory: string,
): Promise<CoreClient | null> {
  try {
    const file = path.join(directory, "core-endpoint.json"),
      stat = fs.lstatSync(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 ||
      stat.uid !== process.getuid?.()
    )
      throw Error("UNSAFE_ENDPOINT");
    const endpoint = JSON.parse(fs.readFileSync(file, "utf8")) as CoreEndpoint;
    if (
      endpoint.api_version !== "1" ||
      !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint.url) ||
      !/^[a-f0-9]{64}$/.test(endpoint.token)
    )
      throw Error("INVALID_ENDPOINT");
    const client = new CoreClient(endpoint),
      core = await client.core();
    if (
      core.instance_id !== endpoint.instance_id ||
      core.data_domain_id !== endpoint.data_domain_id
    )
      throw Error("IDENTITY_MISMATCH");
    if (core.mode !== (process.env.SECRETARY_MODE ?? "fixture"))
      throw Error("CORE_MODE_MISMATCH");
    return client;
  } catch (error) {
    if (/UNSAFE_ENDPOINT|CORE_MODE_MISMATCH/.test(String(error))) throw error;
    return null;
  }
}
export async function startCore(directory: string): Promise<CoreClient> {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const existing = await attachCore(directory);
  if (existing) return existing;
  const log = fs.openSync(
    path.join(directory, "core.log"),
    fs.constants.O_WRONLY |
      fs.constants.O_APPEND |
      fs.constants.O_CREAT |
      fs.constants.O_NOFOLLOW,
    0o600,
  );
  fs.fchmodSync(log, 0o600);
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("./backend.ts", import.meta.url)),
    ],
    {
      env: { ...process.env, SECRETARY_DATA: directory },
      detached: true,
      stdio: ["ignore", log, log],
    },
  );
  fs.closeSync(log);
  child.unref();
  // Concurrent starters may lose the existing Store lock; both attach to its winner.
  for (let n = 0; n < 100; n++) {
    await new Promise((r) => setTimeout(r, 100));
    const client = await attachCore(directory);
    if (client) return client;
  }
  throw Error("CORE_START_FAILED");
}
