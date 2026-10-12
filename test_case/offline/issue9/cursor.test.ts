import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fixture } from "./helpers.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";

test("CUR: restart retains opaque cursor, malformed/domain/tail/digest positions require resync", () =>
  fixture(async (f) => {
    const sync = f.server.service.changes,
      zero = sync.cursor(0),
      first = f.cursor(),
      instance = f.server.service.instanceID;
    f.notice();
    const position = f.cursor(),
      savedSequence = f.app.store.sequence;
    await f.restart();
    assert.notEqual(f.server.service.instanceID, instance);
    assert.equal(f.server.service.changes.position(position), savedSequence);
    assert.equal(f.server.service.changes.position(zero), 0);
    for (const bad of [
      "",
      "a".repeat(1025),
      "%%",
      Buffer.from("null").toString("base64url"),
      Buffer.from(
        JSON.stringify({ owner_id: id(), sequence: 0, digest: "0".repeat(64) }),
      ).toString("base64url"),
    ])
      assert.throws(
        () => f.server.service.changes.position(bad),
        /RESYNC_REQUIRED/,
      );
    const forged = JSON.parse(Buffer.from(position, "base64url").toString());
    for (const patch of [
      { sequence: 9007199254740992 },
      { sequence: -1 },
      { sequence: f.app.store.sequence + 1 },
      { digest: "f".repeat(64) },
    ])
      assert.throws(
        () =>
          f.server.service.changes.position(
            Buffer.from(JSON.stringify({ ...forged, ...patch })).toString(
              "base64url",
            ),
          ),
        /RESYNC_REQUIRED/,
      );
    assert(f.server.service.changes.changes(first).transactions.length);
    assert.equal((await f.raw("sync/changes?after=bad")).status, 409);
    await assert.rejects(
      f.client.query("sync/cursor?limit=1"),
      /INVALID_QUERY/,
    );
    await assert.rejects(f.client.query("sync/changes"), /INVALID_QUERY/);
    await assert.rejects(
      f.client.query("sync/changes?after=" + position + "&limit=101"),
      /INVALID_LIMIT/,
    );
  }));
test("CUR: same identity restored backup rejects divergent digest even after catching up", () =>
  fixture(async (f) => {
    const prefix = f.cursor();
    await f.close();
    const backup = f.dir + "-backup";
    fs.cpSync(f.dir, backup, { recursive: true });
    try {
      await f.open();
      f.notice("branch A");
      const discarded = f.cursor();
      const oldSequence = f.app.store.sequence;
      await f.close();
      fs.rmSync(f.dir, { recursive: true });
      fs.cpSync(backup, f.dir, { recursive: true });
      await f.open();
      assert.throws(
        () => f.server.service.changes.position(discarded),
        /RESYNC_REQUIRED/,
      );
      while (f.app.store.sequence <= oldSequence) f.notice("branch B");
      assert.throws(
        () => f.server.service.changes.position(discarded),
        /RESYNC_REQUIRED/,
      );
      assert(f.server.service.changes.position(prefix) > 0);
    } finally {
      fs.rmSync(backup, { recursive: true, force: true });
    }
  }));
