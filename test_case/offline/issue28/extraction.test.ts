import assert from "node:assert/strict";
import { contentText } from "@earendil-works/pi-ai";
import { testPostgres } from "../helpers/postgres.ts";
import { scenario, shortStream, turn, memory } from "./helpers.ts";
import {
  fixtureModel,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { retryRuntime } from "../../../src/pi_secretary/src/model-retry.ts";
import { applyInputProjection } from "../../../src/pi_secretary/src/input-projection.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import type {
  MemoryExtractionJob,
  Context,
} from "../../../src/pi_secretary/src/contracts.ts";
testPostgres(
  "E5: failed extraction exhausts retries after original-input exit; frozen evidence still supports manual requeue",
  (dsn) => {
    let fail = true,
      sends = 0;
    const stream: StreamFn = (m, c, o) => {
      if (
        c.messages.some(
          (v) =>
            v.role === "system" &&
            contentText(v.content).includes("COMMITMENT_EXTRACTION:"),
        )
      ) {
        sends++;
        return replyStream(
          [{ type: "text", text: fail ? "invalid" : '{"quotes":[]}' }],
          m,
        );
      }
      return shortStream(m, c, o);
    };
    return scenario(
      dsn,
      async (app) => {
        const old = process.env.SECRETARY_RECENT_INPUT_MAX_COUNT;
        process.env.SECRETARY_RECENT_INPUT_MAX_COUNT = "0";
        try {
          await app.world!.migrate();
          let clock = Date.now();
          retryRuntime.set(app.store, {
            now: () => clock,
            wait: async () => {},
          });
          await turn(app, "Synthetic extraction evidence " + "x".repeat(24000));
          await app.host.compact();
          assert(memory(app).input_projection_ref);
          const context = app.store.get<Context>(
            "Context",
            app.host.session.last_context_id!,
          );
          assert(
            !JSON.stringify(
              applyInputProjection(
                app.store,
                memory(app),
                app.store.read(context.raw_context),
              ),
            ).includes("Synthetic extraction evidence"),
          );
          const job = app.store.all<MemoryExtractionJob>(
            "MemoryExtractionJob",
          )[0];
          assert(job);
          assert.equal(sends, 1);
          for (let round = 1; round <= 3; round++) {
            const current = app.store.get<MemoryExtractionJob>(
              "MemoryExtractionJob",
              job.id,
            );
            clock = Date.parse(current.next_attempt_at!);
            await app.host.extractPending();
            assert.equal(sends, round + 1);
          }
          assert.equal(
            app.store.get<MemoryExtractionJob>("MemoryExtractionJob", job.id)
              .next_attempt_at,
            null,
          );
          assert(app.store.bytes(job.source_ref).length > 0);
          fail = false;
          app.host.retryExtractions(id());
          await app.host.extractPending();
          assert.equal(sends, 5);
          assert.equal(
            app.store.get<MemoryExtractionJob>("MemoryExtractionJob", job.id)
              .merged,
            true,
          );
        } finally {
          if (old === undefined)
            delete process.env.SECRETARY_RECENT_INPUT_MAX_COUNT;
          else process.env.SECRETARY_RECENT_INPUT_MAX_COUNT = old;
        }
      },
      stream,
      { ...fixtureModel, contextWindow: 65536 },
    );
  },
);
