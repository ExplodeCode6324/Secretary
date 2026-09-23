import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
export type Endpoint = { url: string; token: string; pid: number };
export async function api(
  endpoint: Endpoint,
  route: string,
  body?: unknown,
): Promise<any> {
  const response = await fetch(endpoint.url + route, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${endpoint.token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const data = (await response.json()) as { error?: string };
  if (!response.ok) throw Error(data.error ?? `HTTP ${response.status}`);
  return data;
}
export async function connectBackend() {
  const directory = path.resolve(process.env.SECRETARY_DATA ?? ".demo-data");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, "ui-endpoint.json");
  const read = async () => {
    try {
      const e = JSON.parse(fs.readFileSync(file, "utf8")) as Endpoint;
      if (
        !/^http:\/\/127\.0\.0\.1:\d+$/.test(e.url) ||
        !/^[a-f0-9]{64}$/.test(e.token)
      )
        return null;
      const health = await api(e, "/api/health");
      if (health.mode !== (process.env.SECRETARY_MODE ?? "fixture"))
        throw Error("BACKEND_MODE_MISMATCH");
      return e;
    } catch (error) {
      if (String(error).includes("BACKEND_MODE_MISMATCH"))
        throw Error(
          "同一数据目录已有不同模型模式的后台，请先停止后台或选择另一数据目录。",
        );
      return null;
    }
  };
  const existing = await read();
  if (existing) return existing;
  const log = fs.openSync(path.join(directory, "ui-backend.log"), "a", 0o600);
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("./backend.ts", import.meta.url)),
    ],
    { env: process.env, detached: true, stdio: ["ignore", log, log] },
  );
  fs.closeSync(log);
  child.unref();
  for (let n = 0; n < 60; n++) {
    await new Promise((r) => setTimeout(r, 100));
    const endpoint = await read();
    if (endpoint) return endpoint;
  }
  throw Error(
    "后台未启动。若旧版 TUI 正在运行，请先 /quit 后重开；详情见数据目录 ui-backend.log。",
  );
}
