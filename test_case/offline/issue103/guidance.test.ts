import { effectiveTools } from "../../../src/pi_secretary/src/budget.ts";
import { Agent } from "../../../src/pi_secretary/src/model.ts";
import { checkpoint } from "../../../src/pi_secretary/src/context.ts";
import { approvalScope } from "../helpers/approval-scope.ts";
import { normalizeContext } from "@earendil-works/pi-ai";
import { durableStream } from "../../../src/pi_secretary/src/transport.ts";
import { EXECUTOR_SYSTEM } from "../../../src/pi_secretary/src/task-prompt.ts";
import { fixtureModel } from "../../../src/pi_secretary/src/model.ts";
import { revise } from "../../../src/pi_secretary/src/store.ts";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture, until, type Fixture } from "../issue9/helpers.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import { guidanceFor } from "../../../src/pi_secretary/src/guidance.ts";
import {
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import type {
  Execution,
  Guidance,
  Input,
  ModelCall,
  TaskResult,
} from "../../../src/pi_secretary/src/contracts.ts";

async function pending(f: Fixture, writesAsk = false) {
  const p = f.app.scheduler.propose(
    "Read evidence and report",
    id(),
    f.app.host.sessionID,
    {
      ...(writesAsk ? approvalScope(f.app) : {}),
      acceptance: ["report evidence"],
      preconditions: [
        {
          condition_id: id(),
          kind: "RESOURCE_PRESENT",
          target: "gate",
          required_revision: null,
        },
      ],
    },
  );
  f.app.scheduler.tick();
  await f.app.scheduler.idle();
  return f.app.store
    .all<Execution>("Execution")
    .find((e) => e.task_id === p.id)!;
}
function send(
  f: Fixture,
  e: Execution,
  text = "Do not edit; inspect only",
  request = id(),
) {
  return f.server.service.command(
    f.server.service.principal,
    `executions/${e.id}/guidance`,
    { request_id: request, task_id: e.task_id, text },
  );
}
function guidance(f: Fixture, e: Execution) {
  return guidanceFor(f.app.store).list(e.id);
}
async function run(f: Fixture, e: Execution, stream: StreamFn) {
  Object.assign(f.app.scheduler, { stream });
  fs.writeFileSync(path.join(f.app.scheduler.rootFor(e), "gate"), "evidence");
  f.app.scheduler.ready(e.id);
  await f.app.scheduler.run(e.id);
  return f.app.store.get<Execution>("Execution", e.id);
}
const result = () => ({
  type: "toolCall" as const,
  id: "result",
  name: "submit_result",
  arguments: {
    outcome: "SUCCEEDED",
    summary: "Observed evidence",
    criteria: [{ id: "C1", met: true, evidence: "read gate" }],
    artifacts: [],
    limitations: [],
  },
});
const receipt = (g: Guidance, outcome = "ADOPTED") => ({
  type: "toolCall" as const,
  id: "receipt",
  name: "guidance_receipt",
  arguments: {
    items: [
      {
        guidance_id: g.id,
        outcome,
        explanation: "Will inspect only",
        effective_requirements: "No edits",
        conflicts_with: [],
        resolution_refs: [],
      },
    ],
  },
});

test("atomic admission, byte preservation, hard rejection, source protection and identity after terminal", () =>
  fixture(async (f) => {
    const e = await pending(f),
      request = id(),
      text = "  中文\n $x \\ raw  ";
    const accepted = send(f, e, text, request);
    const g = guidance(f, e)[0];
    assert.equal(f.app.store.bytes(g.text).toString(), text);
    assert.equal(g.received_at, null);
    const frame = f.app.store.projectionFrames.find((t) =>
      t.mutations.some(
        (m) => m.object_type === "Guidance" && m.object_id === g.id,
      ),
    )!;
    assert.deepEqual(
      new Set(frame.mutations.map((m) => m.object_type)),
      new Set(["Guidance", "Input", "ApiCommand"]),
    );
    assert.equal(
      f.app.store.all<Input>("Input").filter((i) => i.guidance_id === g.id)
        .length,
      1,
    );
    assert.deepEqual(send(f, e, text, request), accepted);
    assert.throws(() => send(f, e, "different", request), /REQUEST_CONFLICT/);
    const before = f.app.store.sequence;
    assert.throws(() => send(f, e, "界".repeat(6000)), /GUIDANCE_TOO_LARGE/);
    assert.equal(f.app.store.sequence, before);
    assert.throws(() =>
      f.server.service.command(
        f.server.service.principal,
        `executions/${e.id}/guidance`,
        { request_id: id(), task_id: e.task_id, text: "x", source: "MASTER" },
      ),
    );
    const view = await f.client.query<any>(`guidance/${g.id}`);
    assert.equal(view.text, text);
    const page = await f.client.query<any>(`executions/${e.id}/guidance`);
    assert.equal(page.items.length, 1);
    f.app.scheduler.cancel(e.id);
    assert.deepEqual(send(f, e, text, request), accepted);
    assert.throws(() => send(f, e), /TARGET_ENDED/);
    assert.equal(guidance(f, e)[0].disposition, "UNPROCESSED");
  }));

test("full request plus reversed-order receipt and result commits GUIDED with result atomically", () =>
  fixture(async (f) => {
    const e = await pending(f);
    send(f, e);
    const g = guidance(f, e)[0];
    let calls = 0;
    const ended = await run(f, e, (_model, context) => {
      calls++;
      assert.match(JSON.stringify(context), new RegExp(g.id));
      return replyStream([result(), receipt(g)]);
    });
    assert.equal(ended.state, "SUCCEEDED");
    assert.equal(calls, 1);
    const current = guidance(f, e)[0];
    assert(current.received_at);
    assert(current.guided_at);
    assert.equal(current.disposition, "ADOPTED");
    const frame = f.app.store.projectionFrames.find((t) =>
      t.mutations.some(
        (m) =>
          m.object_type === "TaskResult" && m.object_id === ended.result_id,
      ),
    )!;
    assert(frame.mutations.some((m) => m.object_type === "GuidanceReceipt"));
    assert(frame.mutations.some((m) => m.object_type === "Guidance"));
    const call = f.app.store.indexed<ModelCall>(
      "ModelCall",
      "scope.execution_id",
      [e.id],
    )[0];
    assert.equal(call.guidance_cutoff, 1);
  }));

test("included but unprocessed guidance fails on first success attempt, no grace counter", () =>
  fixture(async (f) => {
    const e = await pending(f);
    send(f, e);
    let calls = 0;
    const ended = await run(f, e, () => {
      calls++;
      return replyStream([result()]);
    });
    assert.equal(ended.state, "FAILED");
    assert.equal(calls, 1);
    assert.equal(guidance(f, e)[0].disposition, "UNPROCESSED");
    const r = f.app.store.get<TaskResult>("TaskResult", ended.result_id!);
    assert.match(
      JSON.stringify(f.app.store.read(r.detail_ref)),
      /GUIDANCE_NOT_PROCESSED/,
    );
  }));

test("guidance admitted during old request blocks old success then is consumed in the next normal turn", () =>
  fixture(async (f) => {
    const e = await pending(f);
    let calls = 0;
    const ended = await run(f, e, () => {
      calls++;
      if (calls === 1) {
        send(f, e);
        assert.equal(guidance(f, e)[0].received_at, null);
        return replyStream([result()]);
      }
      return replyStream([receipt(guidance(f, e)[0]), result()]);
    });
    assert.equal(ended.state, "SUCCEEDED");
    assert.equal(calls, 2);
    assert(guidance(f, e)[0].guided_at);
    const callsSaved = f.app.store.indexed<ModelCall>(
      "ModelCall",
      "scope.execution_id",
      [e.id],
    );
    assert.equal(callsSaved[0].guidance_cutoff, 0);
    assert.equal(callsSaved[1].guidance_cutoff, 1);
    assert(
      !JSON.stringify(f.app.store.read(callsSaved[0].request)).includes(
        guidance(f, e)[0].id,
      ),
    );
  }));

test("necessary read may precede disposition in a later response", () =>
  fixture(async (f) => {
    const e = await pending(f);
    send(f, e);
    let calls = 0;
    const ended = await run(f, e, () =>
      ++calls === 1
        ? replyStream([
            {
              type: "toolCall",
              id: "read",
              name: "read",
              arguments: { path: "gate" },
            },
          ])
        : replyStream([receipt(guidance(f, e)[0]), result()]),
    );
    assert.equal(ended.state, "SUCCEEDED");
    assert.equal(calls, 2);
  }));

test("explicit conflict waits for Master; Main cannot answer or clear the wait", () =>
  fixture(async (f) => {
    const e = await pending(f);
    send(f, e);
    const ended = await run(f, e, () =>
      replyStream([receipt(guidance(f, e)[0], "CONFLICT"), result()]),
    );
    assert.equal(ended.state, "WAIT_DECISION");
    const did = ended.waiting_request_ids[0];
    const d = await f.client.query<any>(`decisions/${did}`);
    assert.equal(d.required_answerer, "MASTER");
    assert.throws(
      () => f.app.scheduler.answer(did, "ignore it", id(), "MAIN"),
      /DECISION_MASTER_REQUIRED/,
    );
    assert.equal(
      f.app.store.get<Execution>("Execution", e.id).state,
      "WAIT_DECISION",
    );
    send(f, e, "clarification");
    assert.equal(
      f.app.store.get<Execution>("Execution", e.id).state,
      "WAIT_DECISION",
    );
  }));

test("aggregate limits reject before mutation and remain idempotent at limit", () =>
  fixture(async (f) => {
    const e = await pending(f);
    const keys = [id(), id(), id(), id()];
    for (const key of keys) send(f, e, "x".repeat(16384), key);
    const before = f.app.store.sequence;
    assert.throws(() => send(f, e, "x"), /GUIDANCE_LIMIT_REACHED/);
    assert.equal(f.app.store.sequence, before);
    send(f, e, "x".repeat(16384), keys[0]);
    assert.equal(guidance(f, e).length, 4);
  }));

function decide(f: Fixture, decision: "APPROVE" | "REJECT" = "APPROVE") {
  for (const a of f.app.store
    .all<
      import("../../../src/pi_secretary/src/contracts.ts").AuthorizationRequest
    >("AuthorizationRequest")
    .filter((a) => a.state === "PENDING"))
    f.app.authorization.decide({
      schema_version: 1,
      record_type: "ApprovalCommand",
      request_id: id(),
      authorization_id: a.id,
      expected_revision: a.revision,
      display_hash: a.display_hash,
      decision,
    });
}
for (const decision of ["APPROVE", "REJECT"] as const)
  test(`WAIT_AUTH guidance preserves pending; ${decision} follows approved semantics`, () =>
    fixture(async (f) => {
      const e = await pending(f);
      let calls = 0;
      const stream: StreamFn = () =>
        ++calls === 1
          ? replyStream([
              {
                type: "toolCall",
                id: "old-shell",
                name: "bash",
                arguments: { command: "printf old > old.txt" },
              },
            ])
          : replyStream([receipt(guidance(f, e)[0]), result()]);
      const waiting = await run(f, e, stream);
      assert.equal(waiting.state, "WAIT_AUTH");
      send(f, e, "Do not run the old command");
      assert.equal(
        f.app.store.get<Execution>("Execution", e.id).state,
        "WAIT_AUTH",
      );
      assert.equal(guidance(f, e)[0].received_at, null);
      const auth = await f.client.query<any>(
        `authorizations/${waiting.waiting_request_ids[0]}`,
      );
      assert.match(auth.guidance_warning, /replan/);
      decide(f, decision);
      await f.app.scheduler.run(e.id);
      const ended = f.app.store.get<Execution>("Execution", e.id);
      assert.equal(
        ended.state,
        decision === "APPROVE" ? "SUCCEEDED" : "FAILED",
      );
      assert.equal(
        fs.existsSync(path.join(f.app.scheduler.rootFor(e), "old.txt")),
        false,
      );
      if (decision === "APPROVE") {
        const op =
          f.app.store.all<
            import("../../../src/pi_secretary/src/contracts.ts").Operation
          >("Operation")[0];
        assert.equal(op.state, "CANCELLED");
        assert.equal(op.error, "SUPERSEDED_BY_GUIDANCE");
        assert(guidanceFor(f.app.store).isRetired(op));
        assert.equal(calls, 2);
      } else {
        assert.equal(calls, 1);
        assert.equal(guidance(f, e)[0].disposition, "UNPROCESSED");
      }
    }));

test("Main guide derives provenance from its durable tool response and creates no informational echo", () =>
  fixture(async (f) => {
    const e = await pending(f);
    let calls = 0;
    Object.assign(f.app.host, {
      stream: (_model: unknown, context: Parameters<StreamFn>[1]) => {
        const advertised = effectiveTools(context.messages);
        const control = advertised.find((t) => t.name === "task_control")!
          .parameters as { properties: Record<string, unknown> };
        const proposal = advertised.find((t) => t.name === "task_propose")!
          .parameters as { properties: Record<string, unknown> };
        assert(control.properties.task_id && control.properties.text);
        assert(!proposal.properties.task_id && !proposal.properties.text);
        if (calls > 0)
          assert.match(JSON.stringify(context.messages), /THIS_EXECUTION_ONLY/);
        return ++calls === 1
          ? replyStream([
              {
                type: "toolCall",
                id: "main-guide",
                name: "task_control",
                arguments: {
                  action: "guide",
                  id: e.id,
                  task_id: e.task_id,
                  text: "inspect only",
                },
              },
            ])
          : replyStream([{ type: "text", text: "Guidance sent." }]);
      },
    });
    f.app.host.accept("Give that task guidance");
    await f.app.host.drain();
    const g = guidance(f, e)[0];
    assert(g);
    assert.equal(g.source, "MAIN");
    assert.equal(
      f.app.store.all<Input>("Input").filter((i) => i.guidance_id).length,
      0,
    );
    const source = f.app.store.read<any>(g.source_ref);
    assert.equal(source.tool_call_id, "main-guide");
    assert(source.call_id);
    assert.throws(
      () =>
        guidanceFor(f.app.store).main(
          f.app.host.sessionID,
          id(),
          "fabricated",
          id(),
          { id: e.id, task_id: e.task_id, text: "x" },
        ),
      /GUIDANCE_SOURCE_UNPROVEN/,
    );
  }));

for (const phase of ["PREPARED", "IN_FLIGHT", "RESPONSE_SAVED"] as const)
  test(`${phase} recovery preserves the frozen request and places new guidance after the old response`, () =>
    fixture(async (f) => {
      let e = await pending(f);
      fs.writeFileSync(
        path.join(f.app.scheduler.rootFor(e), "gate"),
        "evidence",
      );
      f.app.scheduler.ready(e.id);
      e = f.app.store.get<Execution>("Execution", e.id);
      for (const state of ["DISPATCHING", "RUNNING"] as const) {
        e = revise(e, { state, attempt_id: e.attempt_id ?? id() });
        f.app.store.commit([e]);
      }
      const scope = {
        session_id: null,
        task_id: e.task_id,
        execution_id: e.id,
      };
      const context = normalizeContext({
        systemPrompt: EXECUTOR_SYSTEM,
        messages: [
          { role: "user", content: "Original assignment", timestamp: 0 },
        ],
      });
      const stream = durableStream(
        f.app.store,
        () => replyStream([result()]),
        scope,
        e.id,
        "TASK",
        {
          onPrepared: () => {
            if (phase !== "RESPONSE_SAVED")
              throw Error("SIMULATED_PROCESS_LOSS");
          },
        },
      );
      if (phase !== "RESPONSE_SAVED")
        await assert.rejects(
          Promise.resolve(stream(fixtureModel, context)),
          /SIMULATED_PROCESS_LOSS/,
        );
      else await (await stream(fixtureModel, context)).result();
      let old = f.app.store.indexed<ModelCall>(
        "ModelCall",
        "scope.execution_id",
        [e.id],
      )[0];
      if (phase === "IN_FLIGHT") {
        old = revise(old, {
          state: "IN_FLIGHT",
          started_at: new Date().toISOString(),
        });
        f.app.store.commit([old]);
      }
      assert.equal(old.state, phase);
      const oldRequest = f.app.store.bytes(old.request);
      const queuedAgent = new Agent({
        streamFn: () => {
          throw Error("QUEUE_SEED_MUST_NOT_REQUEST_MODEL");
        },
        initialState: { model: fixtureModel, messages: context.messages },
      });
      if (phase !== "PREPARED")
        guidanceFor(f.app.store).register(e.id, queuedAgent, id(), false);
      send(f, e);
      const g = guidance(f, e)[0];
      if (phase !== "PREPARED") assert(queuedAgent.hasQueuedMessages());
      if (phase === "RESPONSE_SAVED") {
        queuedAgent.state.messages.push(...queuedAgent.peekQueuedMessages());
        const cp = checkpoint(f.app.store, queuedAgent, e.task_id, e.id);
        guidanceFor(f.app.store).checkpoint(
          e.id,
          cp,
          queuedAgent.state.messages,
        );
        f.app.store.commit([
          revise(f.app.store.get<Execution>("Execution", e.id), {
            checkpoint_id: cp.id,
          }),
        ]);
        assert(guidance(f, e)[0].received_at);
      }
      // Discard the process-local queue; reopen the durable store, then replay the old call.
      await f.restart();
      let physical = 0;
      Object.assign(f.app.scheduler, {
        stream: (_model: unknown, ctx: unknown) => {
          physical++;
          return JSON.stringify(ctx).includes(g.id)
            ? replyStream([receipt(g), result()])
            : replyStream([result()]);
        },
      });
      await f.app.scheduler.run(e.id);
      assert.equal(
        f.app.store.get<Execution>("Execution", e.id).state,
        "SUCCEEDED",
      );
      assert.equal(physical, phase === "RESPONSE_SAVED" ? 1 : 2);
      assert.deepEqual(f.app.store.bytes(old.request), oldRequest);
      const calls = f.app.store.indexed<ModelCall>(
        "ModelCall",
        "scope.execution_id",
        [e.id],
      );
      const fresh = f.app.store.read<any>(calls.at(-1)!.request);
      const oldReply = fresh.messages.findIndex(
        (m: any) => m.role === "assistant",
      );
      const injected = fresh.messages.findIndex(
        (m: any) => m.role === "user" && JSON.stringify(m).includes(g.id),
      );
      assert(oldReply >= 0 && injected > oldReply);
      assert.equal(
        fresh.messages.filter(
          (m: any) => m.role === "user" && JSON.stringify(m).includes(g.id),
        ).length,
        1,
      );
      assert(guidance(f, e)[0].guided_at);
    }));

test("post-cutoff guidance picked up by the poll uses actual inclusion and gets no success grace", () =>
  fixture(async (f) => {
    const e = await pending(f),
      service = guidanceFor(f.app.store),
      next = service.nextTurn.bind(service);
    let sent = false,
      calls = 0;
    service.nextTurn = (eid) => {
      next(eid);
      if (!sent) {
        sent = true;
        queueMicrotask(() => send(f, e));
      }
    };
    const ended = await run(f, e, (_m, ctx) => {
      calls++;
      if (calls === 1)
        return replyStream([
          {
            type: "toolCall",
            id: "read",
            name: "read",
            arguments: { path: "gate" },
          },
        ]);
      assert.match(JSON.stringify(ctx), new RegExp(guidance(f, e)[0].id));
      return replyStream([result()]);
    });
    assert.equal(ended.state, "FAILED");
    assert.equal(calls, 2);
    const saved = f.app.store.indexed<ModelCall>(
      "ModelCall",
      "scope.execution_id",
      [e.id],
    );
    assert.equal(saved[1].guidance_cutoff, 0);
    assert(
      JSON.stringify(f.app.store.read(saved[1].request)).includes(
        guidance(f, e)[0].id,
      ),
    );
  }));

test("sequential tools recheck guidance admitted after the first tool, before an old effect", () =>
  fixture(async (f) => {
    const e = await pending(f),
      service = guidanceFor(f.app.store),
      register = service.register.bind(service);
    let sent = false,
      calls = 0;
    service.register = (eid, agent, attempt, held) => {
      register(eid, agent, attempt, held);
      agent.subscribe((event) => {
        if (event.type === "tool_execution_end" && !sent) {
          sent = true;
          send(f, e);
        }
      });
    };
    const ended = await run(f, e, () =>
      ++calls === 1
        ? replyStream([
            {
              type: "toolCall",
              id: "read",
              name: "read",
              arguments: { path: "gate" },
            },
            {
              type: "toolCall",
              id: "old-write",
              name: "write",
              arguments: { path: "must-not-exist", content: "old" },
            },
          ])
        : replyStream([receipt(guidance(f, e)[0]), result()]),
    );
    assert.equal(ended.state, "SUCCEEDED");
    assert.equal(
      fs.existsSync(path.join(f.app.scheduler.rootFor(e), "must-not-exist")),
      false,
    );
    assert.equal(f.app.store.all("Operation").length, 0);
  }));

test("between approved resume-loop shells, later obsolete operation retires instead of running or failing", () =>
  fixture(async (f) => {
    const e = await pending(f);
    let calls = 0;
    const ended = await run(f, e, () =>
      ++calls === 1
        ? replyStream([
            {
              type: "toolCall",
              id: "first-shell",
              name: "bash",
              arguments: { command: "printf started > started.txt; sleep 0.3" },
            },
          ])
        : replyStream([receipt(guidance(f, e)[0]), result()]),
    );
    assert.equal(ended.state, "WAIT_AUTH");
    const cwd = f.app.scheduler.rootFor(e),
      scope = { session_id: null, task_id: e.task_id, execution_id: e.id },
      intent = id();
    const second = f.app.authorization.prepare(
      scope,
      "shell.run",
      cwd,
      f.app.authorization.shellParameters(
        scope,
        "printf forbidden > second.txt",
        120,
        cwd,
        intent,
      ),
      intent,
    );
    decide(f);
    const resumed = f.app.scheduler.run(e.id);
    await until(() => fs.existsSync(path.join(cwd, "started.txt")));
    send(f, e, "Do not run any remaining command");
    await resumed;
    assert.equal(
      f.app.store.get<Execution>("Execution", e.id).state,
      "SUCCEEDED",
    );
    assert.equal(fs.existsSync(path.join(cwd, "second.txt")), false);
    assert(
      guidanceFor(f.app.store).isRetired(
        f.app.store.get("Operation", second.id),
      ),
    );
  }));

test("guidance during shell launcher preparation uses proven NOT_APPLIED, not UNKNOWN or cancellation", () =>
  fixture(async (f) => {
    const e = await pending(f);
    let calls = 0;
    await run(f, e, () =>
      ++calls === 1
        ? replyStream([
            {
              type: "toolCall",
              id: "shell",
              name: "bash",
              arguments: { command: "printf forbidden > barrier.txt" },
            },
          ])
        : replyStream([receipt(guidance(f, e)[0]), result()]),
    );
    decide(f);
    const store = f.app.store,
      commit = store.commit.bind(store);
    let injected = false;
    store.commit = (records, ...rest) => {
      const output = commit(records, ...rest);
      if (
        !injected &&
        records.some(
          (r) =>
            r.record_type === "Operation" && r.process?.state === "STARTING",
        )
      ) {
        injected = true;
        queueMicrotask(() => send(f, e, "Stop before launch"));
      }
      return output;
    };
    await f.app.scheduler.run(e.id);
    assert(injected);
    assert.equal(
      f.app.store.get<Execution>("Execution", e.id).state,
      "SUCCEEDED",
    );
    assert.equal(
      fs.existsSync(path.join(f.app.scheduler.rootFor(e), "barrier.txt")),
      false,
    );
    const op =
      store.all<import("../../../src/pi_secretary/src/contracts.ts").Operation>(
        "Operation",
      )[0];
    assert.equal(op.effect, "NOT_APPLIED");
    assert(guidanceFor(store).isRetired(op));
  }));

test("direct guidance does not unblock Main recovery and normal stages emit no progress feedback", () =>
  fixture(async (f) => {
    const e = await pending(f);
    const session = f.app.host.session;
    f.app.store.commit([
      revise(session, {
        state: "RECOVERY_BLOCKED",
        recovery_error: "test-block",
      }),
    ]);
    send(f, e);
    assert.equal(f.app.host.session.state, "RECOVERY_BLOCKED");
    await run(f, e, () => replyStream([receipt(guidance(f, e)[0]), result()]));
    assert(guidance(f, e)[0].guided_at);
    assert.equal(f.app.host.session.state, "RECOVERY_BLOCKED");
    assert.equal(
      f.app.store.all<Input>("Input").filter((i) => i.guidance_id).length,
      1,
    );
    assert.equal(
      f.app.store
        .all<import("../../../src/pi_secretary/src/contracts.ts").Feedback>(
          "Feedback",
        )
        .filter((x) => x.kind === "PROGRESS").length,
      0,
    );
  }));

test("accepted queue survives restart, then delivery and adoption use one original context copy", () =>
  fixture(async (f) => {
    const e = await pending(f);
    send(f, e, "UNIQUE_GUIDANCE_TEXT");
    const g = guidance(f, e)[0];
    await f.restart();
    let calls = 0;
    const ended = await run(f, e, (_m, ctx) => {
      calls++;
      const original = ctx.messages.filter(
        (m) =>
          m.role === "user" &&
          JSON.stringify(m).includes("UNIQUE_GUIDANCE_TEXT"),
      );
      assert.equal(original.length, 1);
      return calls === 1
        ? replyStream([
            {
              type: "toolCall",
              id: "read",
              name: "read",
              arguments: { path: "gate" },
            },
          ])
        : replyStream([receipt(g), result()]);
    });
    assert.equal(ended.state, "SUCCEEDED");
    assert.equal(guidance(f, e).length, 1);
  }));

test("arrival at the existing model-call cap retains MODEL_CALL_LIMIT and settles guidance without invented adoption", () =>
  fixture(async (f) => {
    const e = await pending(f);
    let calls = 0;
    const ended = await run(f, e, () => {
      calls++;
      if (calls === 20) send(f, e);
      return replyStream([
        {
          type: "toolCall",
          id: "read-" + calls,
          name: "read",
          arguments: { path: "gate" },
        },
      ]);
    });
    assert.equal(calls, 20);
    assert.equal(ended.state, "FAILED");
    const r = f.app.store.get<TaskResult>("TaskResult", ended.result_id!);
    assert.match(
      JSON.stringify(f.app.store.read(r.detail_ref)),
      /MODEL_CALL_LIMIT/,
    );
    assert.equal(guidance(f, e)[0].guided_at, null);
    assert.equal(guidance(f, e)[0].disposition, "UNPROCESSED");
  }));

test("guidance count cap and execution-scoped lookup do not scan unrelated record history", () =>
  fixture(async (f) => {
    const e = await pending(f);
    for (let n = 0; n < 100; n++) f.notice("unrelated " + n);
    const all = f.app.store.all.bind(f.app.store);
    f.app.store.all = () => {
      throw Error("UNBOUNDED_HISTORY_SCAN");
    };
    try {
      for (let n = 0; n < 64; n++) send(f, e, "instruction " + n);
      assert.equal(guidance(f, e).length, 64);
      const before = f.app.store.sequence;
      assert.throws(() => send(f, e), /GUIDANCE_LIMIT_REACHED/);
      assert.equal(f.app.store.sequence, before);
    } finally {
      f.app.store.all = all;
    }
  }));

for (const mode of ["missing", "invalid", "contradictory"] as const)
  test(`${mode} guidance evidence cannot authorize success or provider transmission`, () =>
    fixture(async (f) => {
      const e = await pending(f);
      send(f, e);
      const g = guidance(f, e)[0];
      let calls = 0;
      if (mode === "missing")
        guidanceFor(f.app.store).initialPacket = (_eid, packet) => packet;
      const ended = await run(f, e, () => {
        calls++;
        const valid = receipt(g);
        const bad = receipt(g);
        bad.id = "different";
        if (mode === "invalid") bad.arguments.items[0].guidance_id = id();
        else bad.arguments.items[0].outcome = "CANNOT_APPLY";
        return replyStream([result(), valid, bad]);
      });
      assert.equal(ended.state, "FAILED");
      assert.equal(calls, mode === "missing" ? 0 : 1);
      assert.equal(guidance(f, e)[0].guided_at, null);
      assert.equal(guidance(f, e)[0].disposition, "UNPROCESSED");
      if (mode === "missing") {
        const blocked = f.app.store.logs.filter(
          (l) => l.event_type === "guidance.request_blocked",
        );
        assert.equal(blocked.length, 1);
        assert.equal(f.app.store.read<any>(blocked[0].payload).sent, false);
      }
    }));

test("cancellation during an old request settles newly accepted guidance without resurrection", () =>
  fixture(async (f) => {
    const e = await pending(f);
    let calls = 0;
    const ended = await run(f, e, () => {
      calls++;
      send(f, e);
      f.app.scheduler.cancel(e.id);
      return replyStream([result()]);
    });
    assert.equal(ended.state, "CANCELLED");
    assert.equal(calls, 1);
    assert.equal(guidance(f, e)[0].guided_at, null);
    assert.equal(guidance(f, e)[0].closed_reason, "CANCELLED");
    assert.throws(() => send(f, e), /TARGET_ENDED/);
  }));

test("multiple queued instructions and repeated receipts are processed once per actual response", () =>
  fixture(async (f) => {
    const e = await pending(f);
    send(f, e, "First restriction");
    send(f, e, "Second restriction");
    const [first, second] = guidance(f, e);
    const a = receipt(first),
      b = receipt(second);
    b.id = "second-receipt";
    // Repeated item in one response is idempotent, not another Guidance revision.
    a.arguments.items.push(a.arguments.items[0]);
    const ended = await run(f, e, () => replyStream([result(), a, b]));
    assert.equal(ended.state, "SUCCEEDED");
    assert(
      guidance(f, e).every((g) => g.guided_at && g.disposition === "ADOPTED"),
    );
    assert.equal(
      f.app.store.indexed("GuidanceReceipt", "execution_id", [e.id]).length,
      2,
    );
    await f.restart();
    assert.equal(guidance(f, e).length, 2);
    assert.equal(
      f.app.store.indexed("GuidanceReceipt", "execution_id", [e.id]).length,
      2,
    );
  }));

test("Master answer can resolve a guidance conflict, with answer provenance retained", () =>
  fixture(async (f) => {
    const e = await pending(f);
    send(f, e);
    const g = guidance(f, e)[0];
    await run(f, e, () => replyStream([receipt(g, "CONFLICT")]));
    const waiting = f.app.store.get<Execution>("Execution", e.id);
    const did = waiting.waiting_request_ids[0];
    assert.equal(waiting.state, "WAIT_DECISION");
    f.app.scheduler.answer(did, "Inspect only; do not edit", id(), "MASTER");
    const adopted = receipt(g);
    adopted.arguments.items[0].resolution_refs = [did] as never[];
    Object.assign(f.app.scheduler, {
      stream: () => replyStream([adopted, result()]),
    });
    await f.app.scheduler.run(e.id);
    assert.equal(
      f.app.store.get<Execution>("Execution", e.id).state,
      "SUCCEEDED",
    );
    assert.equal(guidance(f, e)[0].disposition, "ADOPTED");
    assert.equal(
      f.app.store.get<any>("DecisionRequest", did).answered_by,
      "MASTER",
    );
  }));

test("guidance while awaiting the first approved write retires the second approved write", () =>
  fixture(async (f) => {
    const e = await pending(f, true);
    let calls = 0;
    await run(f, e, () =>
      ++calls === 1
        ? replyStream([
            {
              type: "toolCall",
              id: "first-write",
              name: "write",
              arguments: { path: "first.txt", content: "first" },
            },
          ])
        : replyStream([receipt(guidance(f, e)[0]), result()]),
    );
    assert.equal(
      f.app.store.get<Execution>("Execution", e.id).state,
      "WAIT_AUTH",
    );
    const root = f.app.scheduler.rootFor(e);
    const effects = f.app.scheduler as unknown as Pick<
      import("../../../src/pi_secretary/src/scheduler-context.ts").SchedulerContext,
      "fileRevision" | "applyWrite"
    >;
    const target = path.join(root, "second.txt");
    const second = f.app.authorization.prepare(
      { session_id: null, task_id: e.task_id, execution_id: e.id },
      "file.write",
      target,
      { path: "second.txt", content: "forbidden" },
      id(),
      effects.fileRevision(target),
    );
    decide(f);
    const apply = effects.applyWrite.bind(f.app.scheduler);
    let admitted = false;
    effects.applyWrite = async (op) => {
      const value = await apply(op);
      if (!admitted) {
        admitted = true;
        send(f, e, "Do not perform remaining writes");
      }
      return value;
    };
    await f.app.scheduler.run(e.id);
    assert.equal(
      f.app.store.get<Execution>("Execution", e.id).state,
      "SUCCEEDED",
    );
    assert.equal(
      fs.readFileSync(path.join(root, "first.txt"), "utf8"),
      "first",
    );
    assert.equal(fs.existsSync(target), false);
    assert(
      guidanceFor(f.app.store).isRetired(
        f.app.store.get("Operation", second.id),
      ),
    );
  }));

test("same-argument replacement after guidance cannot reuse a retired write approval", () =>
  fixture(async (f) => {
    const e = await pending(f, true);
    const write = {
      type: "toolCall" as const,
      id: "old-write",
      name: "write",
      arguments: { path: "same.txt", content: "same" },
    };
    let calls = 0;
    await run(f, e, () =>
      ++calls === 1
        ? replyStream([write])
        : replyStream([
            { ...write, id: "replacement-write" },
            receipt(guidance(f, e)[0]),
          ]),
    );
    send(
      f,
      e,
      "Reconsider this write; if still appropriate, prepare it again through ordinary authorization.",
    );
    decide(f);
    await f.app.scheduler.run(e.id);
    const state = f.app.store.get<Execution>("Execution", e.id);
    assert.equal(state.state, "WAIT_AUTH");
    assert.equal(
      fs.existsSync(path.join(f.app.scheduler.rootFor(e), "same.txt")),
      false,
    );
    const ops = f.app.store.indexed<any>("Operation", "scope.execution_id", [
      e.id,
    ]);
    assert.equal(ops.length, 2);
    assert.equal(ops[0].state, "CANCELLED");
    assert.equal(ops[1].state, "WAIT_AUTH");
    assert.notEqual(ops[0].authorization_id, ops[1].authorization_id);
  }));

test("restart returns a previously applied tool result before gating unexecuted old tools", () =>
  fixture(async (f) => {
    const e = await pending(f),
      root = f.app.scheduler.rootFor(e),
      store = f.app.store;
    fs.writeFileSync(path.join(root, "gate"), "ready");
    const service = guidanceFor(store),
      register = service.register.bind(service),
      commit = store.commit.bind(store);
    let armed = false,
      crashed = false;
    store.commit = (records, ...rest) => {
      if (
        crashed ||
        (armed && records.some((r) => r.record_type === "ModelCall"))
      ) {
        crashed = true;
        throw Error("SIMULATED_PROCESS_LOSS");
      }
      return commit(records, ...rest);
    };
    service.register = (eid, agent, attempt, held) => {
      register(eid, agent, attempt, held);
      agent.subscribe((event) => {
        if (event.type === "tool_execution_end" && !armed) {
          send(f, e, "From now on, inspect only");
          armed = true;
        }
      });
    };
    Object.assign(f.app.scheduler, {
      stream: () =>
        replyStream([
          {
            type: "toolCall",
            id: "applied-write",
            name: "write",
            arguments: { path: "applied.txt", content: "one effect" },
          },
        ]),
    });
    f.app.scheduler.ready(e.id);
    await f.app.scheduler.run(e.id).catch(() => {});
    assert(armed && crashed);
    assert.equal(
      fs.readFileSync(path.join(root, "applied.txt"), "utf8"),
      "one effect",
    );
    store.commit = commit;
    await f.restart();
    let fresh: Parameters<StreamFn>[1] | undefined;
    Object.assign(f.app.scheduler, {
      stream: (_m: unknown, ctx: Parameters<StreamFn>[1]) => {
        fresh = ctx;
        return replyStream([receipt(guidance(f, e)[0]), result()]);
      },
    });
    await f.app.scheduler.run(e.id);
    const replayed = fresh!.messages.find(
      (m) => m.role === "toolResult" && m.toolCallId === "applied-write",
    );
    assert(replayed);
    assert.doesNotMatch(JSON.stringify(replayed), /GUIDANCE_PENDING/);
    assert.match(JSON.stringify(replayed), /SUCCEEDED|success|Successfully/);
    assert.equal(
      f.app.store.indexed("Operation", "scope.execution_id", [e.id]).length,
      1,
    );
    assert.equal(
      f.app.store.get<Execution>("Execution", e.id).state,
      "SUCCEEDED",
    );
  }));

test("launcher stop retires all remaining obsolete shells and does not swallow a newly adopted write", () =>
  fixture(async (f) => {
    const e = await pending(f),
      root = f.app.scheduler.rootFor(e);
    let calls = 0;
    await run(f, e, () => {
      if (++calls === 1)
        return replyStream([
          {
            type: "toolCall",
            id: "first-shell",
            name: "bash",
            arguments: { command: "printf one > one.txt" },
          },
        ]);
      if (calls === 2)
        return replyStream([
          receipt(guidance(f, e)[0]),
          {
            type: "toolCall",
            id: "adopted-write",
            name: "write",
            arguments: { path: "new.txt", content: "adopted plan" },
          },
        ]);
      return replyStream([result()]);
    });
    const scope = { session_id: null, task_id: e.task_id, execution_id: e.id },
      intent = id();
    const second = f.app.authorization.prepare(
      scope,
      "shell.run",
      root,
      f.app.authorization.shellParameters(
        scope,
        "printf two > two.txt",
        120,
        root,
        intent,
      ),
      intent,
    );
    decide(f);
    const store = f.app.store,
      commit = store.commit.bind(store);
    let admitted = false;
    store.commit = (records, ...rest) => {
      const value = commit(records, ...rest);
      if (
        !admitted &&
        records.some(
          (r) =>
            r.record_type === "Operation" && r.process?.state === "STARTING",
        )
      ) {
        admitted = true;
        queueMicrotask(() =>
          send(
            f,
            e,
            "Stop old shells; instead write new.txt with the text adopted plan.",
          ),
        );
      }
      return value;
    };
    await f.app.scheduler.run(e.id);
    assert(admitted);
    assert.equal(
      f.app.store.get<Execution>("Execution", e.id).state,
      "SUCCEEDED",
    );
    assert.equal(
      fs.readFileSync(path.join(root, "new.txt"), "utf8"),
      "adopted plan",
    );
    assert(
      !fs.existsSync(path.join(root, "one.txt")) &&
        !fs.existsSync(path.join(root, "two.txt")),
    );
    assert(guidanceFor(store).isRetired(store.get("Operation", second.id)));
    assert(
      !store
        .indexed<any>("Operation", "scope.execution_id", [e.id])
        .some((o) => o.state === "AUTHORIZED"),
    );
    assert.equal(guidanceFor(store).currentCall(e.id), undefined);
  }));

test("unresolved conflict after an answer returns to a single explicit wait, not a model-call-limit loop", () =>
  fixture(async (f) => {
    const e = await pending(f);
    send(f, e);
    await run(f, e, () =>
      replyStream([receipt(guidance(f, e)[0], "CONFLICT")]),
    );
    const before = f.app.store.get<Execution>("Execution", e.id),
      did = before.waiting_request_ids[0];
    f.app.scheduler.answer(did, "Inspect only", id(), "MASTER");
    let calls = 0;
    Object.assign(f.app.scheduler, {
      stream: () => {
        calls++;
        return replyStream([result()]);
      },
    });
    await f.app.scheduler.run(e.id);
    const after = f.app.store.get<Execution>("Execution", e.id);
    assert.equal(calls, 1);
    assert.equal(after.state, "WAIT_DECISION");
    assert.notEqual(after.waiting_request_ids[0], did);
    const count = f.app.store.indexed("DecisionRequest", "execution_id", [
      e.id,
    ]).length;
    guidanceFor(f.app.store).waitForConflict(e.id);
    assert.equal(
      f.app.store.indexed("DecisionRequest", "execution_id", [e.id]).length,
      count,
    );
  }));

test("adopted Master guidance does not make an unrelated ordinary question Master-only", () =>
  fixture(async (f) => {
    const e = await pending(f);
    send(f, e);
    await run(f, e, () =>
      replyStream([
        receipt(guidance(f, e)[0]),
        {
          type: "toolCall",
          id: "ordinary",
          name: "request_decision",
          arguments: {
            question: "Which of the permitted sources is relevant?",
          },
        },
      ]),
    );
    const waiting = f.app.store.get<Execution>("Execution", e.id);
    assert.equal(waiting.state, "WAIT_DECISION");
    const d = f.app.store.get<any>(
      "DecisionRequest",
      waiting.waiting_request_ids[0],
    );
    assert.equal(d.required_answerer, undefined);
    assert.doesNotThrow(() =>
      f.app.scheduler.answer(d.id, "The first permitted source", id(), "MAIN"),
    );
  }));

for (const outcome of ["ADOPTED", "UNPROCESSED"] as const)
  test(`Main receives ${outcome} guidance in its existing RESULT input and actual task_query`, () =>
    fixture(async (f) => {
      const e = await pending(f);
      send(f, e);
      const g = guidance(f, e)[0];
      await run(f, e, () =>
        replyStream(
          outcome === "ADOPTED" ? [receipt(g), result()] : [result()],
        ),
      );
      const direct = f.app.store
        .all<Input>("Input")
        .find((i) => i.guidance_id === g.id)!;
      const notice = JSON.parse(f.app.store.bytes(direct.payload).toString());
      assert.equal(notice.guidance_scope, "THIS_EXECUTION_ONLY");
      assert.equal(notice.persistent_changes, "USE_CONTINUATION");
      assert.equal(notice.reporting, "QUIET_UNLESS_CONFLICT");
      f.app.host.deliverFeedback();
      const feedbackInputs = f.app.store
        .all<Input>("Input")
        .filter((i) => i.feedback_id);
      assert.equal(feedbackInputs.length, 1);
      const payload = JSON.parse(
        f.app.store.bytes(feedbackInputs[0].payload).toString(),
      );
      assert.equal(payload.feedback_kind, "RESULT");
      assert.equal(payload.guidance.length, 1);
      assert.equal(payload.guidance[0].guidance_id, g.id);
      assert.equal(payload.guidance[0].disposition, outcome);
      let queried = false,
        calls = 0;
      Object.assign(f.app.host, {
        stream: (_m: unknown, ctx: Parameters<StreamFn>[1]) => {
          if (++calls === 1)
            return replyStream([
              {
                type: "toolCall",
                id: "query-guidance-result",
                name: "task_query",
                arguments:
                  outcome === "ADOPTED"
                    ? { execution_id: e.id }
                    : { task_id: e.task_id },
              },
            ]);
          const returned = ctx.messages.find(
            (m) =>
              m.role === "toolResult" &&
              m.toolCallId === "query-guidance-result",
          );
          assert(returned && returned.role === "toolResult");
          const text = returned.content
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("");
          const response = JSON.parse(text);
          const data = response.details ?? response;
          assert.equal(data.guidance[0].guidance_id, g.id);
          assert.equal(data.guidance[0].disposition, outcome);
          assert.equal(data.detail.guidance, undefined);
          queried = true;
          return replyStream([
            { type: "text", text: "Result checked with its guidance outcome." },
          ]);
        },
      });
      await f.app.host.drain();
      assert(queried);
      assert.equal(
        f.app.store.all<Input>("Input").filter((i) => i.feedback_id).length,
        1,
      );
    }));
