import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fixture, config } from "./helpers.ts";
import { ApplicationService } from "../../../src/pi_secretary/src/application-service.ts";
import { serveCore } from "../../../src/pi_secretary/src/api-v1.ts";
import { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import { validate } from "../../../src/pi_secretary/src/api/protocol.ts";

test("public push API: authenticated admission, replay, CAS, schema, pure reads, pagination and sync", () =>
  fixture(
    async (f) => {
      const server = await serveCore(f.app, 0, undefined, { pump: false });
      try {
        const c = new CoreClient(server.endpoint);
        const request = id();
        const body = { request_id: request, ...config() };
        assert.equal(
          (await fetch(server.endpoint.url + "/api/v1/push-targets")).status,
          401,
        );
        const receipt = await c.command("push-targets", body);
        assert.equal(receipt.resource_ids[0].type, "PushTarget");
        const tid = receipt.resource_ids[0].id;
        assert.deepEqual(await c.command("push-targets", body), receipt);
        await assert.rejects(
          c.command("push-targets", { ...body, name: "different" }),
          /REQUEST_CONFLICT/,
        );
        const t: any = await c.query("push-targets/" + tid);
        validate("PushTarget", t);
        assert.equal(
          t.after_sequence,
          String(f.app.store.firstSequence("PushTarget", tid)),
        );
        const frame = f.app.store.projectionFrames.find((x) =>
          x.mutations.some((m) => m.object_id === request),
        )!;
        assert(frame.mutations.some((m) => m.object_type === "PushTarget"));
        await assert.rejects(
          c.command("push-targets", {
            ...config(),
            request_id: id(),
            token: "forbidden",
          }),
          /INVALID_REQUEST/,
        );
        await assert.rejects(
          c.command("push-targets/" + tid, {
            ...config(),
            request_id: id(),
            expected_revision: "2",
          }),
          /REVISION_CONFLICT/,
        );
        for (const endpoint of [
          "https://user:pass@example.com",
          "https://example.com/secret-key",
          "https://example.com?key=secret",
        ])
          await assert.rejects(
            c.command("push-targets", {
              ...config(endpoint),
              request_id: id(),
            }),
            /INVALID_PUSH_ENDPOINT/,
          );
        await assert.rejects(
          c.command("push-targets", {
            ...config(),
            quiet_hours: {
              timezone: "not-a-zone",
              start: "22:00",
              end: "08:00",
            },
            request_id: id(),
          }),
          /INVALID_QUIET_HOURS/,
        );
        for (const file of fs.readdirSync(path.join(f.dir, "objects"))) {
          const text = fs.readFileSync(
            path.join(f.dir, "objects", file),
            "utf8",
          );
          assert(
            !text.includes("secret-key") &&
              !text.includes("user:pass") &&
              !text.includes("key=secret"),
          );
        }
        const cursor = server.service.changes.cursor();
        f.notify();
        f.notify();
        await f.app.pushes.tick();
        const seq = f.app.store.sequence;
        const page: any = await c.query(
          "push-dispatches?target_id=" + tid + "&limit=1",
        );
        validate("PushDispatchPage", { ...page });
        assert(page.next_cursor);
        const next: any = await c.query(
          "push-dispatches?target_id=" +
            tid +
            "&limit=1&cursor=" +
            encodeURIComponent(page.next_cursor),
        );
        assert.notEqual(next.items[0].id, page.items[0].id);
        await assert.rejects(
          c.query(
            "push-dispatches?state=FAILED&cursor=" +
              encodeURIComponent(page.next_cursor),
          ),
          /CURSOR/,
        );
        const detail: any = await c.query(
          "push-dispatches/" + page.items[0].id,
        );
        validate("PushDispatch", detail);
        assert.equal(detail.state, "DISPATCHED");
        validate("PushTargetPage", await c.query("push-targets"));
        assert.equal(f.app.store.sequence, seq);
        const changes: any = await c.query(
          "sync/changes?after=" + encodeURIComponent(cursor),
        );
        assert(JSON.stringify(changes).includes("push-dispatches"));
        await c.command("push-targets/" + tid, {
          ...config(),
          name: "renamed",
          request_id: id(),
          expected_revision: t.revision,
        });
        const renamed: any = await c.query("push-targets/" + tid);
        assert.equal(renamed.generation, t.generation);
        assert.equal(renamed.after_sequence, t.after_sequence);
      } finally {
        await server.close();
      }
    },
    async () => {},
  ));

test("configuration does not attach admission to unrelated outbox backfill", () =>
  fixture(
    async (f) => {
      const svc = new ApplicationService(f.app);
      const t = f.app.pushes.configure(config());
      f.notify();
      const request = id();
      svc.command(svc.principal, "push-targets/" + t.id, {
        ...config(),
        name: "updated",
        request_id: request,
        expected_revision: String(t.revision),
      });
      const frame = f.app.store.projectionFrames.find((x) =>
        x.mutations.some((m) => m.object_id === request),
      )!;
      assert(frame.mutations.some((m) => m.object_type === "PushTarget"));
      assert(!frame.mutations.some((m) => m.object_type === "PushDispatch"));
      await f.app.pushes.tick();
      assert.equal(f.dispatches().length, 1);
      assert.equal(f.dispatches()[0].state, "DISPATCHED");
      await svc.close();
    },
    async () => {},
  ));
