import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { testPostgres } from "../helpers/postgres.ts";
import { scenario } from "./helpers.ts";
testPostgres(
  "S3: ordinary App pump indexes a committed input within five seconds without search-driven catch-up",
  (dsn) =>
    scenario(dsn, async (app) => {
      await app.world!.migrate();
      app.host.accept("杭州 background projection");
      const event = app.store.logs.findLast(
        (e) => e.event_type === "input.accepted",
      )!;
      const timer = setInterval(() => void app.pump(), 300),
        started = Date.now();
      try {
        for (;;) {
          const result = await app.world!.pool.query(
            "SELECT 1 FROM mem.document WHERE event_id=$1",
            [event.event_id],
          );
          if (result.rowCount) break;
          assert(
            Date.now() - started < 5000,
            "background projection exceeded five seconds",
          );
          await delay(50);
        }
      } finally {
        clearInterval(timer);
        await app.settle();
      }
    }),
);
