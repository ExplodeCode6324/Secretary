import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { normalizeContext } from "@earendil-works/pi-ai";
import { fixture } from "../issue9/helpers.ts";
import {
  fixtureModel,
  roleModel,
} from "../../../src/pi_secretary/src/model.ts";
import { durableStream } from "../../../src/pi_secretary/src/transport.ts";
import {
  modelLifetime,
  retryRuntime,
} from "../../../src/pi_secretary/src/model-retry.ts";
import { boundedTools } from "../../online/tool-budget.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
const context = normalizeContext({
  messages: [
    { role: "user", content: "synthetic timeout control", timestamp: 0 },
  ],
});
for (const mode of ["before_headers", "after_event", "continuous", "cancel"]) {
  test(`Core is sole deadline owner: ${mode}, actual SDK local HTTP`, () =>
    fixture(async (f) => {
      let sends = 0,
        previews = 0;
      const server = http.createServer((req, res) => {
        req.resume();
        sends++;
        if (mode === "before_headers") return;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const chunk = () =>
          res.write(
            "data: " +
              JSON.stringify({
                id: "synthetic",
                object: "chat.completion.chunk",
                created: 0,
                model: "synthetic",
                choices: [
                  { index: 0, delta: { content: "x" }, finish_reason: null },
                ],
              }) +
              "\n\n",
          );
        chunk();
        if (mode === "continuous") {
          const timer = setInterval(chunk, 20);
          res.on("close", () => clearInterval(timer));
        }
        if (mode === "cancel")
          setTimeout(
            () => modelLifetime(f.app.store).abort(Error("CORE_STOPPING")),
            30,
          );
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const model = {
        ...fixtureModel,
        provider: "local-diagnostic",
        baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`,
      };
      retryRuntime.set(f.app.store, { timeoutMs: 300, wait: async () => {} });
      const stream = boundedTools(roleModel(model, "synthetic-key").stream, {
        used: 0,
        limit: 10,
      });
      try {
        await assert.rejects(
          Promise.resolve(
            durableStream(
              f.app.store,
              stream,
              {
                session_id: f.app.host.sessionID,
                task_id: null,
                execution_id: null,
              },
              id(),
              "MAIN",
              {
                observe: (u) => {
                  if (u.type === "event" && u.event.type === "text_delta")
                    previews++;
                },
              },
            )(model, context),
          ),
          mode === "cancel" ? /CANCELLED/ : /TRANSIENT/,
        );
        assert.equal(sends, mode === "cancel" ? 1 : 3);
        if (mode !== "before_headers")
          assert(previews > 0, "preview must arrive before deadline");
        assert(
          f.app.store
            .all<any>("ModelCall")
            .every(
              (c) =>
                c.failure_kind ===
                (mode === "cancel" ? "CANCELLED" : "TRANSIENT"),
            ),
        );
      } finally {
        server.closeAllConnections();
        await new Promise<void>((r) => server.close(() => r()));
      }
    }));
}

test("acceptance fetch refusal survives SDK error wrapping as LOCAL with zero sends", () =>
  fixture(async (f) => {
    const { acceptanceStream } =
      await import("../../online/acceptance-stream.ts");
    const usage = { main: 0, task: 0, tools: 0, calls: [] };
    const limits = { main: 4, task: 4, tools: 8, cutoff: Date.now() + 60000 };
    let physical = 0;
    retryRuntime.set(f.app.store, { wait: async () => {} });
    const model = { ...fixtureModel, baseUrl: "http://127.0.0.1:9/v1" };
    const stream = acceptanceStream(
      roleModel(model, "synthetic-key").stream,
      "main",
      usage,
      limits,
      () => {},
    );
    await assert.rejects(
      Promise.resolve(
        durableStream(
          f.app.store,
          stream,
          {
            session_id: f.app.host.sessionID,
            task_id: null,
            execution_id: null,
          },
          id(),
          "MAIN",
        )(model, context, {
          onPayload: () => {
            limits.cutoff = Date.now() - 1;
          },
          fetch: async () => {
            physical++;
            throw Error("UNEXPECTED_SEND");
          },
        }),
      ),
      /LOCAL.*LIVE_BUDGET_ADMISSION_REFUSED/,
    );
    assert.equal(physical, 0);
    assert.equal(usage.main, 0);
    const calls = f.app.store.all<any>("ModelCall");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].failure_kind, "LOCAL");
    assert.equal(usage.calls.length, 1);
    assert.equal((usage.calls[0] as any).termination, "ADMISSION_REFUSED");
  }));
