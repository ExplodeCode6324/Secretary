import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeContext } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai/compat";
import { configureLiveOutputBudget } from "../../online/issue91-budget.ts";
import { summaryOutputBudget } from "../../../src/pi_secretary/src/budget.ts";
import {
  roleModel,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { durableStream } from "../../../src/pi_secretary/src/transport.ts";
import { Store } from "../../../src/pi_secretary/src/store.ts";
import type { Context } from "../../../src/pi_secretary/src/contracts.ts";

for (const lower of [false, true]) {
  test(`live harness durable and adapter budgets agree for normal/summary/retry, lower=${lower}`, async () => {
    const keys = [
      "SECRETARY_MAIN_OUTPUT_TOKENS",
      "SECRETARY_TASK_OUTPUT_TOKENS",
    ];
    const saved = keys.map((key) => process.env[key]);
    const bodies: Record<string, unknown>[] = [];
    const server = http.createServer(async (req, res) => {
      let text = "";
      for await (const chunk of req) text += chunk;
      bodies.push(JSON.parse(text));
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(
        `data: ${JSON.stringify({ id: "synthetic", object: "chat.completion.chunk", created: 1, model: "synthetic", choices: [{ index: 0, delta: { content: "synthetic" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "issue91-budget-"));
    const store = await Store.open(dir);
    try {
      for (const key of keys) delete process.env[key];
      if (lower) {
        process.env[keys[0]] = "1024";
        process.env[keys[1]] = "2048";
      }
      configureLiveOutputBudget(4096);
      const model = {
        ...getModel("opencode-go", "deepseek-v4.1-flash")!,
        baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
      };
      for (const role of ["main", "task"] as const) {
        const raw = roleModel(model, "synthetic-local-key", role);
        const bounded: StreamFn = (m, c, o) =>
          raw.stream(m, c, {
            ...o,
            maxTokens: Math.min(o?.maxTokens ?? 4096, 4096),
          });
        for (const tokens of [
          4096,
          summaryOutputBudget(model, 1, role),
          summaryOutputBudget(model, 2, role),
        ]) {
          const stream = durableStream(
            store,
            bounded,
            { session_id: null, task_id: null, execution_id: null },
            randomUUID(),
            role === "main" ? "COMPACTION" : "TASK",
            { maxTokens: tokens },
          );
          const response = await (
            await stream(
              model,
              normalizeContext({
                messages: [
                  {
                    role: "user",
                    content: "Synthetic budget verification",
                    timestamp: 1,
                  },
                ],
              }),
            )
          ).result();
          assert.notEqual(response.stopReason, "error", response.errorMessage);
          const expected = lower ? (role === "main" ? 1024 : 2048) : 4096;
          assert.equal(bodies.at(-1)?.max_tokens, expected);
          assert.equal(
            store.all<Context>("Context").at(-1)?.request_budget
              ?.effective_output_tokens,
            expected,
          );
        }
      }
      assert.equal(bodies.length, 6);
    } finally {
      keys.forEach((key, i) => {
        if (saved[i] === undefined) delete process.env[key];
        else process.env[key] = saved[i];
      });
      await store.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
}
