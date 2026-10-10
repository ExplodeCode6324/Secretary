import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { CoreEndpoint } from "./api-v1.ts";
import type { Core, Receipt, Assistant } from "./api/contracts.ts";
export class CoreClient {
  constructor(
    readonly endpoint: CoreEndpoint,
    readonly binding?: string,
  ) {}
  async query<T = unknown>(route: string): Promise<T> {
    return this.request<T>("GET", route);
  }
  async command(
    route: string,
    body: { request_id: string; [key: string]: unknown },
  ): Promise<Receipt> {
    return this.request<Receipt>("POST", route, body);
  }
  bootstrap() {
    return this.query<import("./api/contracts.ts").SyncBootstrap>(
      "sync/bootstrap",
    );
  }
  changes(after: string, page?: string) {
    return this.query<import("./api/contracts.ts").SyncPage>(
      "sync/changes?after=" +
        encodeURIComponent(after) +
        (page ? "&page=" + encodeURIComponent(page) : ""),
    );
  }
  core() {
    return this.query<Core>("core");
  }
  assistant() {
    return this.query<Assistant>("assistant");
  }
  private async request<T>(
    method: string,
    route: string,
    body?: unknown,
  ): Promise<T> {
    if (!/^[a-z][a-z0-9/?=&%_.:-]*$/i.test(route)) throw Error("INVALID_ROUTE");
    const r = await fetch(this.endpoint.url + "/api/v1/" + route, {
      method,
      headers: {
        Authorization: `Bearer ${this.endpoint.token}`,
        ...(this.binding ? { "X-Secretary-Client": this.binding } : {}),
        "Content-Type": "application/json",
        "X-Secretary-API-Version": "1",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const result = (await r.json()) as { data: T; error?: { code: string } };
    if (!r.ok) throw Error(result.error?.code ?? "CORE_REQUEST_FAILED");
    return result.data;
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
