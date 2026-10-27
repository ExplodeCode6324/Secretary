// Synthetic acceptance harness only. Real Core API + deterministic fixture model.
// The logging reverse proxy belongs to this harness, never to the TUI product.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { App } from "../src/app.ts";
import { serveCore } from "../src/api-v1.ts";
import { fixtureModel, fixtureStream } from "../src/model.ts";
const base = path.resolve(".demo-data/issue82-terminal-rollback");
fs.mkdirSync(base, { recursive: true, mode: 0o700 });
const root = process.argv[2]
  ? fs.realpathSync(process.argv[2])
  : fs.mkdtempSync(path.join(base, "native-"));
if (fs.readdirSync(root).length || fs.statSync(root).mode & 0o077)
  throw Error(
    "Fixture requires an empty private directory; never use a live profile",
  );
const app = await App.open(root, {
  model: fixtureModel,
  stream: fixtureStream,
});
const core = await serveCore(app);
const proxy = http.createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1048576) throw Error("request bound");
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    if (req.method === "POST" && req.url === "/api/v1/messages") {
      const parsed = JSON.parse(body.toString("utf8"));
      fs.appendFileSync(
        path.join(root, "acceptance-posts.jsonl"),
        JSON.stringify({
          at: new Date().toISOString(),
          request_id: parsed.request_id,
          bytes: body.length,
          body_base64: body.toString("base64"),
        }) + "\n",
        { mode: 0o600 },
      );
    }
    const headers = { ...req.headers, host: new URL(core.endpoint.url).host };
    delete headers.connection;
    const upstream = http.request(
      core.endpoint.url + req.url,
      { method: req.method, headers },
      (response) => {
        res.writeHead(response.statusCode ?? 500, response.headers);
        response.pipe(res);
        res.on("close", () => response.destroy());
      },
    );
    upstream.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    upstream.end(body);
  } catch {
    res.writeHead(400);
    res.end();
  }
});
await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
const endpoint = {
  ...core.endpoint,
  url: `http://127.0.0.1:${(proxy.address() as import("node:net").AddressInfo).port}`,
};
fs.writeFileSync(
  path.join(root, "core-endpoint.json"),
  JSON.stringify(endpoint),
  { mode: 0o600 },
);
fs.writeFileSync(
  path.join(root, "acceptance-ready.json"),
  JSON.stringify({ root, pid: process.pid, synthetic: true }),
  { mode: 0o600 },
);
console.log(
  `Synthetic Core ready. No real provider.\nProfile: ${root}\nRun in another terminal:\nnpm run tui -- --data ${root} --mode fixture\nPOST evidence: ${root}/acceptance-posts.jsonl\nCtrl+C here stops only this synthetic Core.`,
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  proxy.closeAllConnections();
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
  await core.close();
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.on(signal, () => {
    void close();
  });
