import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import type { PushTarget } from "./contracts.ts";

export class PushFailure extends Error {}
export function pushSecrets(
  directory: string,
  target: PushTarget,
): Record<string, string> {
  try {
    const env =
      process.env[
        "SECRETARY_PUSH_" + target.id.replaceAll("-", "_").toUpperCase()
      ];
    let raw = env;
    if (raw === undefined) {
      const dir = path.join(directory, "push-secrets");
      const stat = fs.lstatSync(dir);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        stat.uid !== process.getuid?.() ||
        (stat.mode & 0o777) !== 0o700
      )
        throw Error();
      const fd = fs.openSync(
        path.join(dir, target.id + ".json"),
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
      );
      try {
        const f = fs.fstatSync(fd);
        if (
          !f.isFile() ||
          f.uid !== process.getuid?.() ||
          (f.mode & 0o777) !== 0o600 ||
          f.size > 8192
        )
          throw Error();
        const buffer = Buffer.alloc(8193);
        const size = fs.readSync(fd, buffer, 0, buffer.length, 0);
        if (size > 8192) throw Error();
        raw = buffer.subarray(0, size).toString("utf8");
      } finally {
        fs.closeSync(fd);
      }
    }
    if (Buffer.byteLength(raw) > 8192) throw Error();
    const value = JSON.parse(raw);
    const keys = target.kind === "NTFY" ? ["topic", "token"] : ["device_key"];
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some((k) => !keys.includes(k))
    )
      throw Error();
    for (const v of Object.values(value))
      if (typeof v !== "string" || !v || /[\r\n\0]/.test(v)) throw Error();
    if (
      target.kind === "NTFY"
        ? !/^[A-Za-z0-9_-]{1,64}$/.test(value.topic ?? "")
        : !value.device_key
    )
      throw Error();
    return value;
  } catch {
    throw new PushFailure("SECRET_UNAVAILABLE");
  }
}
export const notificationScript =
  'on run argv\ndisplay notification (item 1 of argv) with title "Secretary"\nend run';
export async function sendPush(
  directory: string,
  target: PushTarget,
  message: string,
  signal: AbortSignal,
) {
  if (target.kind === "MACOS_NOTIFICATION") {
    if (process.platform !== "darwin")
      throw new PushFailure("UNSUPPORTED_PLATFORM");
    await new Promise<void>((resolve, reject) => {
      execFile(
        "/usr/bin/osascript",
        ["-e", notificationScript, message],
        {
          signal,
          timeout: 10000,
          maxBuffer: 8192,
          env: { PATH: "/usr/bin:/bin" },
        },
        (error) =>
          error ? reject(new PushFailure("TRANSPORT_FAILED")) : resolve(),
      );
    });
    return;
  }
  const secret = pushSecrets(directory, target);
  const body =
    target.kind === "NTFY"
      ? { topic: secret.topic, message, title: "Secretary" }
      : { device_key: secret.device_key, body: message, title: "Secretary" };
  const response = await fetch(
    target.endpoint! + (target.kind === "BARK" ? "/push" : "/"),
    {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(target.kind === "NTFY" && secret.token
          ? { Authorization: "Bearer " + secret.token }
          : {}),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new PushFailure("PROVIDER_REJECTED");
  }
  let size = 0;
  const chunks: Uint8Array[] = [];
  const reader = response.body?.getReader();
  if (!reader) throw new PushFailure("PROVIDER_REJECTED");
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8192) throw new PushFailure("PROVIDER_REJECTED");
      chunks.push(value);
    }
    const receipt = JSON.parse(Buffer.concat(chunks).toString());
    if (
      target.kind === "BARK"
        ? receipt.code !== 200
        : receipt.event !== "message" ||
          typeof receipt.id !== "string" ||
          !receipt.id
    )
      throw new PushFailure("PROVIDER_REJECTED");
  } catch {
    throw new PushFailure("PROVIDER_REJECTED");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
