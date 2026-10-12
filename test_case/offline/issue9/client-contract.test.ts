import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture } from "./helpers.ts";

// Minimal contract harness: a refresh generation orders concurrent responses; failures
// leave invalidations pending. The data and APPLIED cursor share one atomic checkpoint.
class Cache {
  issued = 0;
  pending = true;
  data: unknown;
  cursor: string;
  constructor(
    readonly file: string,
    initial: string,
  ) {
    const saved = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8"))
      : null;
    this.cursor = saved?.cursor ?? initial;
    this.data = saved?.data;
  }
  async refresh(
    query: () => Promise<unknown>,
    cursor: string,
    crashBeforeCheckpoint = false,
  ) {
    const generation = ++this.issued;
    this.pending = true;
    try {
      const data = await query();
      if (generation !== this.issued) return;
      if (crashBeforeCheckpoint) return;
      fs.writeFileSync(this.file + ".tmp", JSON.stringify({ data, cursor }));
      fs.renameSync(this.file + ".tmp", this.file);
      this.data = data;
      this.cursor = cursor;
      this.pending = false;
    } catch {
      if (generation === this.issued) this.pending = true;
    }
  }
}
test("VIEW: latest-issued response wins; latest failure keeps refresh pending and cannot advance applied cursor", () =>
  fixture(async (f) => {
    const initial = f.cursor(),
      file = path.join(f.dir, "synthetic-client-cache.json"),
      c = new Cache(file, initial);
    let slow!: (data: unknown) => void;
    const first = c.refresh(() => new Promise((r) => (slow = r)), "first");
    await c.refresh(
      async () => ({ revision: "1", latest_state: "new" }),
      "new",
    );
    slow({ revision: "1", latest_state: "old" });
    await first;
    assert.deepEqual(c.data, { revision: "1", latest_state: "new" });
    assert.equal(c.cursor, "new");
    const second = c.refresh(
      () => new Promise((r) => (slow = r)),
      "old-success",
    );
    await c.refresh(async () => {
      throw Error("synthetic network failure");
    }, "failed");
    slow({ revision: "2" });
    await second;
    assert(c.pending);
    assert.equal(c.cursor, "new");
    await c.refresh(async () => ({ revision: "3" }), "received-only", true);
    const restarted = new Cache(file, initial);
    assert.equal(restarted.cursor, "new");
    await restarted.refresh(async () => ({ revision: "3" }), "applied");
    assert.equal(new Cache(file, initial).cursor, "applied");
  }));
test("NEW: initial boundary suppresses historical notifications even after read/presented, later creations are new", () =>
  fixture(async (f) => {
    const old = f.notice(),
      boundary: any = await f.client.query("sync/cursor"),
      client = await f.register(),
      fresh = f.notice();
    await f.client.command(`notifications/${old.id}/presented`, {
      request_id: crypto.randomUUID(),
      client_id: client,
    });
    await f.client.command(`notifications/${old.id}/read`, {
      request_id: crypto.randomUUID(),
    });
    const page: any = await f.client.query("notifications");
    assert.deepEqual(
      page.items
        .filter(
          (n: any) => BigInt(n.created_sequence) > BigInt(boundary.sequence),
        )
        .map((n: any) => n.id),
      [fresh.id],
    );
  }));
