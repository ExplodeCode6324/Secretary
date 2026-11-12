import assert from "node:assert/strict";
import { testPostgres } from "../helpers/postgres.ts";
import { scenario, shortStream, turn, memory } from "./helpers.ts";
import {
  fixtureModel,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { requestBudget } from "../../../src/pi_secretary/src/budget.ts";
import type { InputProjectionReceipt } from "../../../src/pi_secretary/src/input-projection.ts";
import type { CompactionJob } from "../../../src/pi_secretary/src/contracts.ts";
testPostgres(
  "E1: 200 actual Host rounds stay within request budget and use a bounded original-input window",
  (dsn) => {
    let sends = 0;
    const stream: StreamFn = (m, c, o) => {
      const b = requestBudget(m, c.messages, { maxTokens: o?.maxTokens });
      assert(b.estimated_tokens <= b.usable_input_tokens);
      sends++;
      return shortStream(m, c, o);
    };
    return scenario(
      dsn,
      async (app) => {
        await app.world!.migrate();
        for (let n = 0; n < 200; n++)
          await turn(
            app,
            `Synthetic completed round ${n}: ` + "abcdefghij".repeat(250),
          );
        await app.host.compact();
        const cs = memory(app);
        assert(cs.input_projection_ref);
        const p = app.store.read<InputProjectionReceipt>(
          cs.input_projection_ref,
        );
        assert(p.window_input_ids.length <= 12);
        const jobs = app.store
          .all<CompactionJob>("CompactionJob")
          .filter((j) => j.mode === "CONTEXT_COMPACTION");
        assert(jobs.length > 0);
        // The required World reserve plus system/tool anchors exceed the old
        // 30% target at 64 KiB. Preserve those anchors and report the limit.
        assert.equal(jobs.at(-1)!.target_reached, false);
        const last = app.store.read<any>(
          app.store.events("context.compacted").at(-1)!.payload,
        );
        assert.equal(
          last.reason,
          "PRESERVED_INPUT_OR_ACTIVE_PROTOCOL_EXCEEDS_TARGET",
        );
        assert(last.after.occupancy > 0.3 && last.after.occupancy < 0.6);
        assert(last.after.estimated_tokens < last.before.estimated_tokens);
        assert(sends >= 200);
      },
      stream,
      { ...fixtureModel, contextWindow: 65536 },
    );
  },
);
