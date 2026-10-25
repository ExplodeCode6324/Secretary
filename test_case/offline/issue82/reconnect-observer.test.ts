import assert from "node:assert/strict";
import test from "node:test";
import { MainSync } from "../../../src/pi_secretary/src/tui/sync.ts";
const settle = async () => {
  for (let n = 0; n < 30; n++) await Promise.resolve();
};
for (const observer of ["absent", "record", "throw"] as const)
  for (const cancel of [false, true])
    test(`reconnect ${observer} observer preserves ${cancel ? "cancellation" : "backoff and success reset"}`, async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const delays: number[] = [],
        events: any[] = [];
      const timer = globalThis.setTimeout;
      t.mock.method(globalThis, "setTimeout", ((
        fn: any,
        delay: any,
        ...args: any[]
      ) => {
        delays.push(delay);
        return timer(fn, delay, ...args);
      }) as any);
      const binding = {
        api_version: "1",
        mode: "fixture",
        data_domain_id: "observer",
      };
      let attempts = 0;
      const store = {
        state: { binding, anchor: null },
        writer: {
          loadCheckpoint: async () => ({ value: null, snapshot: null }),
        },
      };
      let sync: MainSync;
      const callback =
        observer === "absent"
          ? undefined
          : (event: any) => {
              events.push(event);
              if (observer === "throw") throw Error("observer failure");
            };
      sync = new (MainSync as any)(
        store,
        async () => {
          attempts++;
          if (attempts <= 2) throw Error("attach failure");
          if (attempts === 4) {
            sync.close();
            throw Error("done");
          }
          return { core: { ...binding, instance_id: "fixture" }, client: {} };
        },
        callback,
      );
      (sync as any).query = async () => ({
        cursor: "0",
        instance_id: "fixture",
      });
      (sync as any).snapshot = async () => ({
        page: { items: [], generation: "g" },
        session: {},
      });
      (sync as any).catchup = async () => {};
      (sync as any).refresh = async () => {};
      (sync as any).readStream = async () => {
        throw Error("stream ended");
      };
      await sync.start();
      await settle();
      assert.deepEqual(delays, [1000]);
      if (cancel) {
        sync.close();
        await settle();
        assert.equal(attempts, 1);
        t.mock.timers.tick(10000);
        await settle();
        assert.equal(attempts, 1);
      } else {
        t.mock.timers.tick(1000);
        await settle();
        assert.deepEqual(delays, [1000, 2000]);
        t.mock.timers.tick(2000);
        await settle();
        assert.deepEqual(delays, [1000, 2000, 1000]);
        t.mock.timers.tick(1000);
        await settle();
        assert.equal(attempts, 4);
      }
      await (sync as any).loop;
      if (observer !== "absent") {
        assert.ok(events.every((event) => Object.isFrozen(event)));
        assert.equal(events.length, cancel ? 2 : 6);
        assert.deepEqual(
          events.map((x) => x.phase),
          cancel ? [0, 1] : [0, 1, 0, 1, 0, 1],
        );
        assert.deepEqual(
          events.filter((x) => x.phase === 0).map((x) => x.delayMs),
          cancel ? [1000] : [1000, 2000, 1000],
        );
        assert.equal(events.at(-1).aborted, cancel ? 1 : 0);
      }
    });
