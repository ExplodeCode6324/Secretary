import assert from "node:assert/strict";
import { testPostgres } from "../helpers/postgres.ts";
import { scenario, shortStream, turn, memory, apply } from "./helpers.ts";
import { fixtureModel } from "../../../src/pi_secretary/src/model.ts";
import {
  applyInputProjection,
  type InputProjectionReceipt,
} from "../../../src/pi_secretary/src/input-projection.ts";
import type { Context } from "../../../src/pi_secretary/src/contracts.ts";
testPostgres(
  "E4: repeated Settings and restart authenticate a bounded wrapper without resurrecting retired originals",
  (dsn) =>
    scenario(
      dsn,
      async (app, reopen) => {
        await app.world!.migrate();
        for (let n = 0; n < 25; n++)
          await turn(app, `Original-${n} ` + "filler ".repeat(400));
        await app.host.compact();
        const before = app.store.read<InputProjectionReceipt>(
          memory(app).input_projection_ref!,
        );
        const first = await apply(app);
        assert(first.input_projection_ref);
        const context = app.store.get<Context>("Context", first.context_id!);
        const raw = app.store.read<any[]>(context.raw_context);
        assert(!JSON.stringify(raw).includes("Original-0"));
        assert.deepEqual(
          applyInputProjection(app.store, memory(app), raw),
          raw,
        );
        app = await reopen();
        await app.world!.memorySearch.catchUp();
        await apply(app);
        await turn(app, "Continue after restart.");
        const latest = app.store.get<Context>(
          "Context",
          app.host.session.last_context_id!,
        );
        assert(
          !JSON.stringify(app.store.read(latest.raw_context)).includes(
            "Original-0",
          ),
        );
        assert(before.window_input_ids.length <= 12);
      },
      shortStream,
      { ...fixtureModel, contextWindow: 65536 },
    ),
);
