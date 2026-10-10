import { openSyncStream } from "./sync-stream.ts";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { App } from "./app.ts";
import { ApplicationService } from "./application-service.ts";
import { ApiError, errorOf } from "./api/protocol.ts";
export type CoreEndpoint = {
  api_version: "1";
  url: string;
  token: string;
  pid: number;
  instance_id: string;
  data_domain_id: string;
};
export async function serveCore(
  app: App,
  port = 0,
  onShutdown?: () => void,
  options: { pump?: boolean } = {},
) {
  const token = randomBytes(32).toString("hex");
  let close!: () => Promise<void>;
  const service = new ApplicationService(app, () => {
    if (onShutdown) onShutdown();
    else void close();
  });
  let pumping: Promise<void> | undefined;
  const timer =
    options.pump === false
      ? undefined
      : setInterval(() => {
          if (!pumping)
            pumping = app
              .pump()
              .catch(() => {})
              .finally(() => {
                pumping = undefined;
              });
        }, 300);
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const send = (status: number, data: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };
    try {
      const address = server.address() as import("node:net").AddressInfo;
      const host = `127.0.0.1:${address.port}`;
      if (
        req.headers.host !== host ||
        (req.headers.origin && req.headers.origin !== `http://${host}`)
      )
        throw new ApiError("FORBIDDEN_ORIGIN", 403);
      const auth = Buffer.from(req.headers.authorization ?? ""),
        expected = Buffer.from(`Bearer ${token}`);
      if (auth.length !== expected.length || !timingSafeEqual(auth, expected))
        throw new ApiError("UNAUTHENTICATED", 401);
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (!url.pathname.startsWith("/api/v1/"))
        throw new ApiError(
          url.pathname.startsWith("/api/v")
            ? "UNSUPPORTED_VERSION"
            : "NOT_FOUND",
          404,
        );
      if (
        req.headers["x-secretary-api-version"] &&
        req.headers["x-secretary-api-version"] !== "1"
      )
        throw new ApiError("UNSUPPORTED_VERSION", 400);
      const route = url.pathname.slice("/api/v1/".length);
      const binding = req.headers["x-secretary-client"];
      if (Array.isArray(binding)) throw new ApiError("INVALID_CLIENT_BINDING");
      if (req.method === "GET") {
        if (route === "sync/stream")
          return await openSyncStream(
            service,
            req,
            res,
            url.searchParams,
            binding,
          );
        const artifact = /^artifacts\/([^/]+)\/content$/.exec(route);
        if (artifact) {
          const entry = service.artifact(artifact[1]);
          if (entry.state === "archived")
            throw new ApiError("ARTIFACT_ARCHIVED", 410);
          if (entry.state !== "available")
            throw new ApiError("ARTIFACT_UNAVAILABLE", 410);
          const ref = entry.artifact.content;
          if (!/^objects\/[a-f0-9]{64}$/.test(ref.path))
            throw new ApiError("ARTIFACT_UNAVAILABLE", 410);
          const objects = path.join(app.store.dir, "objects");
          if (fs.lstatSync(objects).isSymbolicLink())
            throw new ApiError("ARTIFACT_UNAVAILABLE", 410);
          const fd = fs.openSync(
            path.join(app.store.dir, ref.path),
            fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
          );
          try {
            const stat = fs.fstatSync(fd);
            if (!stat.isFile() || stat.size !== ref.bytes)
              throw new ApiError("ARTIFACT_UNAVAILABLE", 410);
            const digest = createHash("sha256");
            for await (const bytes of fs.createReadStream("", {
              fd,
              autoClose: false,
              start: 0,
              highWaterMark: 65536,
            }))
              digest.update(bytes);
            if (digest.digest("hex") !== ref.sha256)
              throw new ApiError("ARTIFACT_UNAVAILABLE", 410);
            res.writeHead(200, {
              "Content-Type": "application/octet-stream",
              "Content-Length": ref.bytes,
              ETag: `"${ref.sha256}"`,
              "Content-Disposition":
                "attachment; filename*=UTF-8''" +
                encodeURIComponent(entry.artifact.name),
            });
            await pipeline(
              fs.createReadStream("", {
                fd,
                autoClose: false,
                start: 0,
                highWaterMark: 65536,
              }),
              res,
            );
          } finally {
            fs.closeSync(fd);
          }
          return;
        }
        const data = await service.query(
          service.principal,
          route,
          url.searchParams,
          binding,
        );
        return send(200, { api_version: "1", data });
      }
      if (req.method !== "POST") throw new ApiError("METHOD_NOT_ALLOWED", 405);
      if (
        !/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")
      )
        throw new ApiError("UNSUPPORTED_MEDIA_TYPE", 415);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) throw new ApiError("REQUEST_TOO_LARGE", 413);
        chunks.push(chunk);
      }
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        throw new ApiError("INVALID_JSON");
      }
      const data = service.command(service.principal, route, body, binding);
      send(202, { api_version: "1", data });
    } catch (error) {
      const e = errorOf(error);
      if (!res.headersSent)
        send(e.status, {
          api_version: "1",
          error: {
            code: e.code,
            message: e.code,
            ...(e.details ? { details: e.details } : {}),
          },
        });
      else res.destroy();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const endpoint: CoreEndpoint = {
    api_version: "1",
    url: `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`,
    token,
    pid: process.pid,
    instance_id: service.instanceID,
    data_domain_id: service.identity.owner_id,
  };
  let closing: Promise<void> | undefined;
  close = () =>
    (closing ??= (async () => {
      if (timer) clearInterval(timer);
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await pumping;
      await service.close();
      await app.close();
    })());
  return { endpoint, service, close };
}
