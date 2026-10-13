import assert from "node:assert/strict";
import { testPostgres } from "../helpers/postgres.ts";
import { scenario } from "./helpers.ts";
import { base, id, now } from "../../../src/pi_secretary/src/store.ts";
import {
  readLog,
  bodyChunks,
} from "../../../src/pi_secretary/src/memory-search.ts";
import { replyStream } from "../../../src/pi_secretary/src/model.ts";
import type {
  Feedback,
  Notification,
  TaskResult,
} from "../../../src/pi_secretary/src/contracts.ts";

testPostgres(
  "S1/S2: actual locale, literal Chinese/English, long tails, cross-block and lossless read",
  (dsn) =>
    scenario(dsn, async (app) => {
      const world = app.world!;
      await world.migrate();
      const meta = (
        await world.pool.query(
          "SELECT current_setting('server_version_num') AS version,datctype,datlocprovider FROM pg_database WHERE datname=current_database()",
        )
      ).rows[0];
      assert(Number(meta.version) >= 180000);
      assert(meta.datctype);
      assert(meta.datlocprovider);
      const long =
        "x".repeat(2040) +
        "杭州见😀" +
        "中".repeat(9000) +
        "TAIL_literal%_\\english";
      const input = app.host.accept(long),
        duplicate = app.host.accept(long);
      await world.memorySearch.catchUp();
      for (const query of [
        "杭州",
        "杭州见",
        "😀",
        "TAIL_literal%_\\english",
        "english",
      ]) {
        const result = await world.memorySearch.search({
          query,
          kinds: ["input"],
        });
        assert.equal(result.status, "ready");
        assert.equal(result.hits.length, 2, query);
        assert.equal(new Set(result.hits.map((h) => h.event_id)).size, 2);
      }
      const event = app.store.logs.find(
        (e) =>
          e.event_type === "input.accepted" &&
          app.store.read<any>(e.payload).id === input.id,
      )!;
      const parts: string[] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const page = readLog(app.store, event.event_id, offset, 123);
        assert("body" in page);
        parts.push(page.body!);
        offset = page.next_offset!;
      }
      assert.equal(parts.join(""), long);
      assert.notEqual(input.id, duplicate.id);
      const chunks = bodyChunks(long);
      assert(chunks.length > 10);
      assert(
        chunks.some((c) => c.body.includes("杭州见")),
        "full cross-boundary term",
      );
      assert(chunks.at(-1)!.body.endsWith("TAIL_literal%_\\english"));
      const timeoutFree = await world.memorySearch.search({
        query: "杭州",
        from: now(),
        to: "2999-01-01T00:00:00Z",
      });
      assert.equal(timeoutFree.hits.length, 0);
      await assert.rejects(
        () => world.memorySearch.search({ query: "杭州", from: "2026-01-01" }),
        /INVALID_SEARCH_TIME/,
      );
    }),
);

testPostgres(
  "S1: frozen replies, task/result/feedback scope, notifications and joint filters",
  (dsn) =>
    scenario(dsn, async (app) => {
      await app.world!.migrate();
      const session_id = app.host.sessionID,
        task_id = id(),
        scope_id = id(),
        execution_id = id();
      const scope = { session_id, task_id, execution_id };
      const ref = app.store.put("synthetic evidence", "text/plain");
      const result: TaskResult = {
        schema_version: 1,
        record_type: "TaskResult",
        ...base(),
        task_id,
        execution_id,
        scope_id,
        outcome: "SUCCEEDED",
        summary: "杭州见 TASK result",
        limitations: [],
        evidence: [ref],
        artifacts: [],
        detail_ref: ref,
        needs_action: false,
        verified_by: "NOT_VERIFIED",
        observed_at: now(),
      };
      const feedback: Feedback = {
        schema_version: 1,
        record_type: "Feedback",
        ...base(),
        task_id,
        execution_id,
        scope_id,
        state: "DELIVERED",
        kind: "RESULT",
        summary: "杭州见 TASK feedback",
        detail_ref: ref,
        result_id: result.id,
        decision_request_id: null,
        input_id: null,
        created_at: now(),
      };
      const notice: Notification = {
        schema_version: 1,
        record_type: "Notification",
        ...base(),
        state: "QUEUED",
        session_id,
        channel: "local-ui",
        message: app.store.put("杭州见 NOTICE", "text/plain"),
        delivery_key: id(),
        receipt: null,
        requested_at: now(),
      };
      const reply = await replyStream([
        { type: "text", text: "杭州见 final reply" },
        { type: "thinking", thinking: "PRIVATE_THINKING_MARKER" },
      ]).result();
      const intermediate = await replyStream([
        { type: "toolCall", id: id(), name: "synthetic", arguments: {} },
      ]).result();
      app.store.commit(
        [result, feedback, notice],
        [
          app.store.event("execution.finished", result, scope),
          app.store.event("feedback.delivered", feedback, scope),
          app.store.event("notification.queued", notice, {
            session_id,
            task_id: null,
            execution_id: null,
          }),
          app.store.event("main.message", reply, {
            session_id,
            task_id: null,
            execution_id: null,
          }),
          app.store.event("main.message", intermediate, {
            session_id,
            task_id: null,
            execution_id: null,
          }),
        ],
      );
      app.host.accept("杭州见 scheduler wrapper", id(), "SCHEDULER");
      const search = app.world!.memorySearch;
      await search.catchUp();
      const tasks = await search.search({
        query: "杭州见",
        scope_id,
        task_id,
        kinds: ["task"],
      });
      assert.equal(tasks.hits.length, 2);
      assert(
        tasks.hits.every(
          (h) => h.scope_id === scope_id && h.task_id === task_id,
        ),
      );
      assert.equal(
        (await search.search({ query: "杭州见", scope_id: id() })).hits.length,
        0,
      );
      assert.equal(
        (await search.search({ query: "PRIVATE_THINKING_MARKER" })).hits.length,
        0,
      );
      const all = await search.search({ query: "杭州见" });
      assert.equal(all.hits.length, 4);
      for (const hit of all.hits)
        assert("body" in readLog(app.store, hit.event_id));
    }),
);
