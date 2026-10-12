import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture, until } from "./helpers.ts";

test("READ: repeated resource, cursor, changes, pagination and SSE reads do not write Store/CAS or invoke models", () =>
  fixture(async (f) => {
    f.notice();
    const s = f.app.store,
      baseline = {
        sequence: s.sequence,
        digest: s.digest,
        objects: fs.readdirSync(path.join(s.dir, "objects")).sort(),
        records: JSON.stringify(s.projectionFrames),
        inputs: s.all("Input").length,
        models: s.all("ModelCall").length,
      };
    for (let n = 0; n < 3; n++) {
      for (const route of [
        "sync/cursor",
        "sync/changes?after=" + f.cursor(),
        "notifications",
        "notifications/" + s.all("Notification")[0].id,
        "session",
        "memory",
        "settings",
        "tasks",
        "attention",
        "timeline",
        "related",
      ])
        await f.client.query(route);
      const controller = new AbortController();
      const response = await fetch(
        f.server.endpoint.url + "/api/v1/sync/stream?after=" + f.cursor(),
        {
          headers: { Authorization: `Bearer ${f.server.endpoint.token}` },
          signal: controller.signal,
        },
      );
      assert.equal(response.status, 200);
      await response.body!.getReader().read();
      controller.abort();
      await until(() => f.server.streams.active === 0);
    }
    assert.deepEqual(
      {
        sequence: s.sequence,
        digest: s.digest,
        objects: fs.readdirSync(path.join(s.dir, "objects")).sort(),
        records: JSON.stringify(s.projectionFrames),
        inputs: s.all("Input").length,
        models: s.all("ModelCall").length,
      },
      baseline,
    );
  }));
