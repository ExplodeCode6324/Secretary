import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture, config, provider, Fixture } from "./helpers.ts";
import { quietNow } from "../../../src/pi_secretary/src/push-service.ts";
import {
  pushSecrets,
  PushFailure,
} from "../../../src/pi_secretary/src/push-transport.ts";
import {
  fixtureStream,
  replyStream,
} from "../../../src/pi_secretary/src/model.ts";
import { contentText } from "@earendil-works/pi-ai";

for (const kind of ["NTFY", "BARK"] as const)
  test(`${kind}: real HTTP publish, unicode preview, provider receipt and no presentation`, () =>
    provider(async (endpoint, received) =>
      fixture(async (f) => {
        const t = f.app.pushes.configure({ ...config(endpoint), kind });
        const secret =
          kind === "NTFY"
            ? { topic: "synthetic-secret-topic", token: "synthetic-token" }
            : { device_key: "synthetic-device-key" };
        f.secret(t, secret);
        f.notify("😀".repeat(250));
        await f.app.pushes.tick();
        assert.equal(received.length, 1);
        const b = received[0].body;
        assert.equal([...(b.message ?? b.body).split("\n")[0]].length, 200);
        assert.equal(received[0].url, kind === "BARK" ? "/push" : "/");
        assert.equal(
          kind === "BARK" ? b.device_key : received[0].auth,
          kind === "BARK" ? "synthetic-device-key" : "Bearer synthetic-token",
        );
        assert.equal(f.dispatches()[0].state, "DISPATCHED");
        assert(f.dispatches()[0].dispatched_at);
        assert.equal(
          f.app.store.logs.filter(
            (l) => l.event_type === "notification.presented",
          ).length,
          0,
        );
        assert.equal(
          (f.app.store.all("Notification")[0] as any).read_at,
          undefined,
        );
        await f.app.pushes.tick();
        assert.equal(received.length, 1);
        for (const file of fs.readdirSync(path.join(f.dir, "objects"))) {
          const text = fs.readFileSync(
            path.join(f.dir, "objects", file),
            "utf8",
          );
          for (const value of Object.values(secret))
            assert(!text.includes(value));
        }
        for (const file of fs
          .readdirSync(f.dir)
          .filter((x) => x.includes("journal")))
          assert(
            !fs
              .readFileSync(path.join(f.dir, file), "utf8")
              .includes("synthetic-token"),
          );
      }),
    ));

test("MasterInteract through Host settle invokes the independent push worker", () =>
  provider(async (endpoint, received) => {
    const f = new Fixture(undefined, (model, context, options) =>
      context.messages.at(-1)?.role === "user" &&
      contentText(context.messages.at(-1)!.content) === "push now"
        ? replyStream(
            [
              {
                type: "toolCall",
                id: "synthetic-notify",
                name: "MasterInteract",
                arguments: { message: "notification from Host" },
              },
            ],
            model,
          )
        : fixtureStream(model, context, options),
    );
    try {
      await f.open();
      const t = f.app.pushes.configure(config(endpoint));
      f.secret(t, { topic: "synthetic" });
      f.app.host.accept("push now");
      await f.app.settle();
      assert.equal(received.length, 1);
      assert.equal(f.dispatches()[0].state, "DISPATCHED");
    } finally {
      await f.close();
    }
  }));

test("B1: cutoff excludes history, DND/name edits preserve backlog, re-enable starts a new generation", () =>
  fixture(
    async (f) => {
      f.notify("old");
      let t = f.app.pushes.configure({
        ...config(),
        quiet_hours: { timezone: "UTC", start: "11:00", end: "13:00" },
      });
      f.notify("pending");
      await f.app.pushes.tick();
      assert.equal(f.dispatches().length, 1);
      assert.equal(f.dispatches()[0].state, "PENDING");
      t = f.app.pushes.configure(
        { ...config(), name: "renamed" },
        t.id,
        t.revision,
      );
      assert.equal(t.generation, f.dispatches()[0].generation);
      await f.app.pushes.tick();
      assert.equal(f.dispatches()[0].state, "DISPATCHED");
      f.notify("cancel");
      f.app.pushes.reconcile();
      t = f.app.pushes.configure(
        { ...config(), enabled: false },
        t.id,
        t.revision,
      );
      assert.equal(f.dispatches()[1].state, "CANCELLED");
      f.notify("disabled");
      t = f.app.pushes.configure(config(), t.id, t.revision);
      await f.app.pushes.tick();
      assert.equal(f.dispatches().length, 2);
      f.notify("new");
      await f.app.pushes.tick();
      assert.equal(f.dispatches().length, 3);
    },
    async () => {},
  ));

for (const success of [true, false])
  test(`B2: disable during SENDING preserves actual ${success ? "success" : "failure"} outcome`, () => {
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((r) => (started = r));
    return fixture(
      async (f) => {
        const t = f.app.pushes.configure(config());
        f.notify();
        const pending = f.app.pushes.tick();
        await ready;
        f.app.pushes.configure(
          { ...config(), enabled: false },
          t.id,
          t.revision,
        );
        assert.equal(f.dispatches()[0].state, "SENDING");
        release();
        await pending;
        assert.equal(
          f.dispatches()[0].state,
          success ? "DISPATCHED" : "CANCELLED",
        );
      },
      async () => {
        started();
        await new Promise<void>((r) => (release = r));
        if (!success) throw Error("provider secret");
      },
    );
  });

test("B3: retry budget, fixed batch membership and rolling rate survive restart", () => {
  let calls = 0;
  return fixture(
    async (f) => {
      const t = f.app.pushes.configure(config());
      f.notify("one");
      f.notify("two");
      await f.app.pushes.tick();
      assert.equal(calls, 1);
      assert.equal(f.dispatches()[0].batch_id, f.dispatches()[1].batch_id);
      await f.restart();
      f.time += 29999;
      await f.app.pushes.tick();
      assert.equal(calls, 1);
      f.time++;
      await f.app.pushes.tick();
      assert.equal(calls, 2);
      f.notify("new batch");
      await f.app.pushes.tick();
      assert.equal(calls, 3);
      assert.notEqual(f.dispatches()[0].batch_id, f.dispatches()[2].batch_id);
      assert.equal(f.app.pushes.target(t.id).revision, 1);
      for (const delay of [120000, 600000, 600000]) {
        f.time += delay;
        await f.app.pushes.tick();
      }
      const first = f.dispatches()[0];
      assert.equal(first.state, "FAILED");
      assert.equal(first.attempts, 4);
      assert.equal(first.error_code, "TRANSPORT_FAILED");
      assert.equal(first.attempt_history.length, 4);
    },
    async () => {
      calls++;
      throw Error("sensitive provider error");
    },
  );
});

test("DND across midnight and DST uses target local time; rate overflow merges into one summary", () => {
  const messages: string[] = [];
  return fixture(
    async (f) => {
      let t = f.app.pushes.configure({
        ...config(),
        quiet_hours: {
          timezone: "America/New_York",
          start: "22:00",
          end: "08:00",
        },
      });
      assert(quietNow(t, Date.parse("2030-03-10T06:59:00Z")));
      assert(quietNow(t, Date.parse("2030-03-10T07:01:00Z")));
      assert(!quietNow(t, Date.parse("2030-03-10T12:00:00Z")));
      f.notify("one");
      f.notify("two");
      await f.app.pushes.tick();
      assert.equal(messages.length, 0);
      f.time = Date.parse("2030-01-01T13:00:00Z");
      await f.app.pushes.tick();
      assert.equal(messages.length, 1);
      assert(messages[0].startsWith("2 条通知"));
      for (let i = 0; i < 2; i++) {
        f.notify();
        await f.app.pushes.tick();
      }
      f.notify("overflow1");
      f.notify("overflow2");
      await f.restart();
      await f.app.pushes.tick();
      assert.equal(messages.length, 3);
      f.time += 60000;
      await f.app.pushes.tick();
      assert.equal(messages.length, 4);
      assert(messages[3].startsWith("2 条通知"));
    },
    async (_dir, _t, message) => {
      messages.push(message);
    },
  );
});

test("B4: file permissions, symlinks, environment precedence and live credential rotation", () =>
  fixture(async (f) => {
    const t = f.app.pushes.configure(config());
    assert.throws(() => pushSecrets(f.dir, t), /SECRET_UNAVAILABLE/);
    const file = f.secret(t, { topic: "first" });
    assert.equal(pushSecrets(f.dir, t).topic, "first");
    fs.chmodSync(file, 0o644);
    assert.throws(() => pushSecrets(f.dir, t), /SECRET_UNAVAILABLE/);
    fs.chmodSync(file, 0o600);
    fs.writeFileSync(file, JSON.stringify({ topic: "second" }));
    assert.equal(pushSecrets(f.dir, t).topic, "second");
    const env = "SECRETARY_PUSH_" + t.id.replaceAll("-", "_").toUpperCase();
    process.env[env] = JSON.stringify({ topic: "environment" });
    try {
      assert.equal(pushSecrets(f.dir, t).topic, "environment");
      process.env[env] = "invalid";
      assert.throws(() => pushSecrets(f.dir, t), /SECRET_UNAVAILABLE/);
    } finally {
      delete process.env[env];
    }
    fs.renameSync(file, file + ".real");
    fs.symlinkSync(file + ".real", file);
    assert.throws(() => pushSecrets(f.dir, t), /SECRET_UNAVAILABLE/);
    f.notify();
    await f.app.pushes.tick();
    assert.equal(f.dispatches()[0].error_code, "SECRET_UNAVAILABLE");
  }));

test("JSON notices only expose text; parallel tick sends once and snapshots no private metadata", () => {
  const messages: string[] = [];
  return fixture(
    async (f) => {
      f.app.pushes.configure(config());
      f.notify({ text: "safe", execution_id: "private-execution" });
      await Promise.all([f.app.pushes.tick(), f.app.pushes.tick()]);
      assert.equal(messages.length, 1);
      assert.equal(messages[0], "safe\n在客户端查看");
    },
    async (_d, _t, m) => {
      messages.push(m);
    },
  );
});

test("HTTP redirects, oversized and negative provider responses fail without retaining contents", () =>
  provider(async (endpoint, received, respond) =>
    fixture(async (f) => {
      const t = f.app.pushes.configure({ ...config(endpoint), kind: "BARK" });
      f.secret(t, { device_key: "synthetic-key" });
      for (const handler of [
        (_q: any, r: any) => {
          r.writeHead(302, { Location: endpoint });
          r.end();
        },
        (_q: any, r: any) => r.end("x".repeat(9000)),
        (_q: any, r: any) =>
          r.end(JSON.stringify({ code: 400, message: "sensitive" })),
      ]) {
        respond(handler);
        f.notify();
        await f.app.pushes.tick();
        f.time += 60000;
      }
      assert(f.dispatches().every((d) => d.state !== "DISPATCHED"));
      assert(!JSON.stringify(f.dispatches()).includes("sensitive"));
      assert(received.length <= 3);
    }),
  ));

test("batch bound, capped recovery and shutdown retain truthful delivery state", () => {
  let calls = 0;
  return fixture(
    async (f) => {
      f.app.pushes.configure(config());
      for (let i = 0; i < 101; i++) f.notify();
      await f.app.pushes.tick();
      assert.equal(
        f.dispatches().filter((d) => d.state === "DISPATCHED").length,
        100,
      );
      await f.app.pushes.tick();
      assert.equal(calls, 2);
      assert.equal(
        f.dispatches().filter((d) => d.state === "DISPATCHED").length,
        101,
      );
      await f.app.pushes.close();
      f.notify();
      await f.app.pushes.tick();
      assert.equal(calls, 2);
    },
    async () => {
      calls++;
    },
  );
});
