import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { contentText } from "@earendil-works/pi-ai";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import { TerminalController } from "../../../src/pi_secretary/src/tui.ts";
import type { RecoveryRequest } from "../../../src/pi_secretary/src/memory-extraction-recovery.ts";

const TTL = 300_000;
const promise = "I will report the synthetic result tomorrow.";
const expiryError =
  /EXTRACTION_RECOVERY_AUTHORIZATION_(?:EXPIRED|BINDING_MISMATCH): re-preflight required/;
function diskState(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (dir: string) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const filename = path.join(dir, item.name);
      if (item.isDirectory()) visit(filename);
      else if (item.isFile())
        files[path.relative(root, filename)] = createHash("sha256")
          .update(fs.readFileSync(filename))
          .digest("hex");
    }
  };
  visit(root);
  return files;
}
async function fixture(
  body: (f: {
    app: () => App;
    dir: string;
    counts: { extraction: number; summary: number };
    succeed: () => void;
    reopen: () => Promise<void>;
    request: () => RecoveryRequest;
  }) => Promise<void>,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue4-expiry-host-"));
  const counts = { extraction: 0, summary: 0 };
  let fail = true;
  const stream: StreamFn = (model, context, options) => {
    const system = contentText(context.messages[0].content);
    if (system.includes("COMMITMENT_EXTRACTION:")) {
      counts.extraction++;
      return replyStream(
        [
          {
            type: "text",
            text: fail
              ? "invalid extraction"
              : JSON.stringify({ quotes: [promise] }),
          },
        ],
        model,
      );
    }
    if (system.includes("CONSCIOUSNESS:")) {
      counts.summary++;
      return fixtureStream(model, context, options);
    }
    return replyStream([{ type: "text", text: promise }], model);
  };
  let app = await App.open(dir, { model: fixtureModel, stream });
  try {
    app.host.accept("Please report the synthetic result tomorrow.");
    await app.host.drain();
    await app.host.compact();
    assert.equal(counts.extraction, 1);
    await body({
      app: () => app,
      dir,
      counts,
      succeed: () => {
        fail = false;
      },
      reopen: async () => {
        await app.close();
        app = await App.open(dir, { model: fixtureModel, stream });
      },
      request: () => {
        const group = app.host.memoryRecoveryPreflight()[0];
        assert.equal(group.status, "READY");
        assert(group.binding);
        return { request_id: id(), ...group.binding };
      },
    });
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("expiry Host: stable preflight changes no persistent bytes and exact TTL rejects first consumption", async (t) => {
  await fixture(async (f) => {
    let clock = Date.now();
    t.mock.method(Date, "now", () => clock);
    const before = diskState(f.dir),
      sequence = f.app().store.sequence;
    const request = f.request();
    assert(request.authorization_id);
    assert(request.issued_at);
    assert(request.expires_at);
    assert.equal(
      Date.parse(request.expires_at) - Date.parse(request.issued_at),
      TTL,
    );
    assert.deepEqual(
      f.app().host.memoryRecoveryPreflight()[0].binding,
      (({ request_id: _, ...binding }) => binding)(request),
    );
    assert.equal(f.app().store.sequence, sequence);
    assert.deepEqual(diskState(f.dir), before);
    clock = Date.parse(request.expires_at) - 1;
    assert.equal(
      f.app().host.memoryRecoveryPreflight()[0].binding!.authorization_id,
      request.authorization_id,
    );
    clock++;
    await assert.rejects(f.app().host.recoverMemory(request), expiryError);
    assert.equal(f.counts.extraction, 1);
    assert.equal(f.app().store.sequence, sequence);
    assert.deepEqual(diskState(f.dir), before);
    const fresh = f.request();
    assert.notEqual(fresh.authorization_id, request.authorization_id);
    f.succeed();
    const summaries = f.counts.summary;
    assert.equal((await f.app().host.recoverMemory(fresh)).status, "SUCCEEDED");
    assert.equal(f.counts.extraction, 2);
    assert.equal(f.counts.summary, summaries);
  });
});

test("expiry Host: unconsumed ticket dies on restart while a fresh preflight can authorize once", async () => {
  await fixture(async (f) => {
    const request = f.request();
    await f.reopen();
    const before = f.app().store.sequence;
    await assert.rejects(f.app().host.recoverMemory(request), expiryError);
    assert.equal(f.app().store.sequence, before);
    assert.equal(f.counts.extraction, 1);
    const fresh = f.request();
    assert.notEqual(fresh.authorization_id, request.authorization_id);
    f.succeed();
    assert.equal((await f.app().host.recoverMemory(fresh)).status, "SUCCEEDED");
    assert.equal(f.counts.extraction, 2);
  });
});

test("expiry Host: failed consumed receipt replays after TTL and restart without another send", async (t) => {
  await fixture(async (f) => {
    let clock = Date.now();
    t.mock.method(Date, "now", () => clock);
    const request = f.request(),
      first = await f.app().host.recoverMemory(request);
    assert.equal(first.status, "FAILED");
    assert.equal(f.counts.extraction, 2);
    clock += TTL + 1;
    assert.deepEqual(await f.app().host.recoverMemory(request), first);
    await f.reopen();
    assert.deepEqual(await f.app().host.recoverMemory(request), first);
    assert.equal(f.counts.extraction, 2);
  });
});

test("expiry TUI: displays expiry, rejects stale first consumption, and replays a consumed success after restart", async (t) => {
  await fixture(async (f) => {
    let clock = Date.now();
    t.mock.method(Date, "now", () => clock);
    let output: string[] = [];
    let ui = new TerminalController(f.app(), (line) => output.push(line));
    await ui.command("/memory-recovery");
    assert.match(output.join("\n"), /5分钟/);
    assert.match(output.join("\n"), /expires_at/);
    const request = f.request();
    clock = Date.parse(request.expires_at!);
    await assert.rejects(
      ui.command("/memory-recover " + JSON.stringify(request)),
      expiryError,
    );
    assert.equal(f.counts.extraction, 1);
    const fresh = f.request();
    f.succeed();
    output = [];
    await ui.command("/memory-recover " + JSON.stringify(fresh));
    assert.match(output.join("\n"), /SUCCEEDED/);
    assert.equal(f.counts.extraction, 2);
    clock += TTL + 1;
    await f.reopen();
    output = [];
    ui = new TerminalController(f.app(), (line) => output.push(line));
    await ui.command("/memory-recover " + JSON.stringify(fresh));
    assert.match(output.join("\n"), /SUCCEEDED/);
    assert.equal(f.counts.extraction, 2);
  });
});

test("expiry API v1: expired first consumption is rejected by owner; consumed replay stays idempotent", async (t) => {
  const { serveCore } = await import("../../../src/pi_secretary/src/api-v1.ts");
  const { CoreClient } =
    await import("../../../src/pi_secretary/src/core-client.ts");
  const { reconciled } = await import("../issue8/helpers.ts");
  await fixture(async (f) => {
    let clock = Date.now();
    t.mock.method(Date, "now", () => clock);
    const backend = await serveCore(f.app(), 0, undefined, { pump: false });
    const client = new CoreClient(backend.endpoint);
    const preflight = async () =>
      (await client.query<any>("memory/recovery")).items[0];
    try {
      const group = await preflight(),
        request = { request_id: id(), ...group.binding };
      assert.equal(group.status, "READY");
      clock = Date.parse(request.expires_at);
      await client.command("memory/recovery", request);
      const expired = await reconciled(client, request.request_id);
      assert.equal(expired.receipt.state, "UNKNOWN");
      assert.match(
        expired.receipt.error_code,
        /EXTRACTION_RECOVERY_AUTHORIZATION_(EXPIRED|BINDING_MISMATCH)/,
      );
      assert.equal(f.counts.extraction, 1);
      const fresh = { request_id: id(), ...(await preflight()).binding };
      f.succeed();
      await client.command("memory/recovery", fresh);
      const first = await reconciled(client, fresh.request_id);
      assert.equal(first.result.status, "SUCCEEDED");
      assert.equal(first.result.owner_committed, true);
      clock += TTL + 1;
      await client.command("memory/recovery", fresh);
      assert.deepEqual(await reconciled(client, fresh.request_id), first);
      assert.equal(f.counts.extraction, 2);
    } finally {
      await backend.close();
    }
  });
});
