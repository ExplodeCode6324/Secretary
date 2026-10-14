// Bounded loopback-only generated body; no user file or credentials are read.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const [root, sizeText] = process.argv.slice(2);
const size = Number(sizeText);
if (!Number.isSafeInteger(size) || size < 1 || size > 1073741824)
  throw Error("invalid size");
const delay = Number(process.env.SECRETARY_RESOURCE_THROTTLE_MS ?? 0);
if (![0, 1].includes(delay)) throw Error("invalid throttle");
const chunk = Buffer.alloc(65536, 97);
const hash = createHash("sha256");
for (let left = size; left > 0; left -= chunk.length)
  hash.update(chunk.subarray(0, Math.min(left, chunk.length)));
const version = hash.digest("hex");
const token = "b".repeat(64);
const server = http.createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`)
    return res.writeHead(401).end();
  const binary = req.url.startsWith("/api/v1/artifacts/");
  const count = binary ? size : 8388609;
  res.writeHead(200, { "Content-Length": count, ETag: `"${version}"` });
  for (let left = count; left > 0 && !res.destroyed; left -= chunk.length) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    if (!res.write(chunk.subarray(0, Math.min(left, chunk.length)))) {
      await new Promise((resolve) => {
        res.once("drain", resolve);
        res.once("close", resolve);
      });
      res.removeAllListeners("drain");
      res.removeAllListeners("close");
    }
  }
  res.end();
});
server.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(
    path.join(root, "resource.json"),
    JSON.stringify({
      version,
      endpoint: {
        api_version: "1",
        url: `http://127.0.0.1:${server.address().port}`,
        token,
        pid: process.pid,
        instance_id: "10000000-0000-4000-8000-000000000001",
        data_domain_id: "10000000-0000-4000-8000-000000000002",
      },
    }),
    { mode: 0o600 },
  );
});
