// Private loopback fault fixture used by the Swift transport/cache tests.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const root = process.argv[2];
const bytes = Buffer.alloc(4096, 97);
const version = createHash("sha256").update(bytes).digest("hex");
const token = "a".repeat(64);
const server = http.createServer((req, res) => {
  const id = req.url.split("/")[4];
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401).end();
    return;
  }
  if (id === "redirect") {
    res.writeHead(302, { Location: "/api/v1/artifacts/normal/content" }).end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Length": id === "oversize" ? bytes.length + 1 : bytes.length,
    ETag: `"${id === "etag" ? "0".repeat(64) : version}"`,
  });
  fs.writeFileSync(path.join(root, `started-${id}`), "1");
  let timer;
  res.on("close", () => {
    clearInterval(timer);
    fs.writeFileSync(path.join(root, `closed-${id}`), "1");
  });
  if (id === "stall" || id === "cancel" || id === "disconnect") {
    res.write(bytes.subarray(0, 256));
  } else if (id === "drip") {
    let offset = 0;
    timer = setInterval(() => {
      res.write(bytes.subarray(offset, (offset += 256)));
      if (offset === bytes.length) {
        clearInterval(timer);
        res.end();
      }
    }, 100);
  } else if (id === "short") {
    res.end(bytes.subarray(0, 256));
  } else {
    res.end(id === "corrupt" ? Buffer.alloc(bytes.length, 98) : bytes);
  }
});
server.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(
    path.join(root, "endpoint.json.tmp"),
    JSON.stringify({
      api_version: "1",
      url: `http://127.0.0.1:${server.address().port}`,
      token,
      pid: process.pid,
      instance_id: "10000000-0000-4000-8000-000000000001",
      data_domain_id: "10000000-0000-4000-8000-000000000002",
    }),
    { mode: 0o600 },
  );
  fs.renameSync(
    path.join(root, "endpoint.json.tmp"),
    path.join(root, "endpoint.json"),
  );
});
