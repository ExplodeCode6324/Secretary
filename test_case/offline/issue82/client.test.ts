import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  CoreClient,
  CoreTransportError,
  inspectCore,
} from "../../../src/pi_secretary/src/core-client.ts";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
test("frozen JSON is sent verbatim; typed errors distinguish real receipt NOT_FOUND from malformed routes", async () => {
  const received: string[] = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      received.push(Buffer.concat(chunks).toString());
      res.writeHead(202).end(
        JSON.stringify({
          api_version: "1",
          data: { request_id: "r", command: "messages" },
        }),
      );
    } else if (req.url?.endsWith("/requests/r"))
      res
        .writeHead(404)
        .end(
          JSON.stringify({ api_version: "1", error: { code: "NOT_FOUND" } }),
        );
    else if (req.url?.endsWith("/large"))
      res.writeHead(200).end("x".repeat(4096));
    else res.writeHead(404).end("route not found");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const client = new CoreClient({
    api_version: "1",
    url: `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`,
    token: "a".repeat(64),
    pid: 0,
    instance_id: "i",
    data_domain_id: "d",
  });
  try {
    const body = '{ "text": "中文\\t", "request_id": "r" }';
    await client.commandFrozen("messages", body, "r", digest(body));
    assert.deepEqual(received, [body]);
    await assert.rejects(
      client.commandFrozen("messages", body, "other", digest(body)),
      /INVALID_FROZEN_BODY/,
    );
    await assert.rejects(
      client.query("requests/r"),
      (e: unknown) =>
        e instanceof CoreTransportError &&
        e.status === 404 &&
        e.code === "NOT_FOUND" &&
        e.envelopeValid &&
        e.route === "requests/r",
    );
    await assert.rejects(
      client.query("wrong"),
      (e: unknown) =>
        e instanceof CoreTransportError && e.status === 404 && !e.envelopeValid,
    );
    await assert.rejects(
      client.query("large", { maxBytes: 1024 }),
      /RESPONSE_TOO_LARGE/,
    );
    assert.equal(received.length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("strict attach cannot start Core or infer ownership from a Core lock", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "issue82-attach-"));
  try {
    fs.writeFileSync(path.join(root, "owner.lock"), "do not read or mutate");
    assert.equal((await inspectCore(root, "fixture")).status, "STOPPED");
    fs.writeFileSync(path.join(root, "core-endpoint.json"), "{}", {
      mode: 0o600,
    });
    assert.equal((await inspectCore(root, "fixture")).status, "UNSAFE");
    assert.equal(
      fs.readFileSync(path.join(root, "owner.lock"), "utf8"),
      "do not read or mutate",
    );
    assert.deepEqual(fs.readdirSync(root).sort(), [
      "core-endpoint.json",
      "owner.lock",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});
