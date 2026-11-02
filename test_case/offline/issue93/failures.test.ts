import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../issue9/helpers.ts";
import { execution } from "../issue92/helpers.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import { failuresFor } from "../../../src/pi_secretary/src/failure-handling.ts";
import type {
  Input,
  Execution,
} from "../../../src/pi_secretary/src/contracts.ts";

test("terminal cancel is not dismissal; Main intent is atomic, exact-ID replay and durable dismissal preserve FAILED", () =>
  fixture(async (f) => {
    const e = await execution(f);
    f.app.scheduler.finish(e.id, "FAILED", { error: "first failure" });
    const key = "EXECUTION:" + e.id,
      sid = f.app.host.sessionID;
    f.app.scheduler.cancel(e.id);
    assert.equal(
      failuresFor(f.app.store).view(key, sid).disposition,
      "UNRESOLVED",
    );
    const request = id(),
      body = {
        request_id: request,
        text: "",
        failure_action: {
          failure_key: key,
          expected_revision: "0",
          action: "DISMISS",
        },
      };
    await f.client.command("messages", body);
    await f.client.command("messages", body);
    const inputs = f.app.store
      .all<Input>("Input")
      .filter((i) => i.dedupe_key === request);
    assert.equal(inputs.length, 1);
    const loop = id();
    f.app.store.commit([
      revise(inputs[0], { state: "CLAIMED", loop_id: loop }),
    ]);
    const service = failuresFor(f.app.store),
      call = id();
    const out = service.perform(
      sid,
      loop,
      call,
      "dismiss_failure",
      { id: key },
      f.app.scheduler,
    );
    assert.equal(out.accepted, true);
    assert.equal(service.view(key, sid).disposition, "DISMISSED");
    assert.deepEqual(
      service.perform(
        sid,
        loop,
        call,
        "dismiss_failure",
        { id: key },
        f.app.scheduler,
      ),
      out,
    );
    assert.equal(f.app.store.get<Execution>("Execution", e.id).state, "FAILED");
    await f.restart();
    assert.equal(
      failuresFor(f.app.store).view(key, sid).disposition,
      "DISMISSED",
    );
    const page = await f.client.query<{ items: { id: string }[] }>(
      "attention?view=master",
    );
    assert(!page.items.some((i) => i.id === e.id));
  }));

test("redo cannot weaken requirements; failed attempt is durable and a new intent cannot replace its target", () =>
  fixture(async (f) => {
    const e = await execution(f);
    f.app.scheduler.finish(e.id, "FAILED", { error: "failure" });
    const key = "EXECUTION:" + e.id,
      sid = f.app.host.sessionID,
      request = id();
    await f.client.command("messages", {
      request_id: request,
      text: "",
      failure_action: {
        failure_key: key,
        expected_revision: "0",
        action: "REDO",
      },
    });
    const input = f.app.store
      .all<Input>("Input")
      .find((i) => i.dedupe_key === request)!;
    const loop = id();
    f.app.store.commit([revise(input, { state: "CLAIMED", loop_id: loop })]);
    const service = failuresFor(f.app.store);
    const result = service.perform(
      sid,
      loop,
      id(),
      "task_propose",
      {
        reuse_task_id: e.task_id,
        parent_execution_id: e.id,
        acceptance_criteria: [],
      },
      f.app.scheduler,
    );
    assert.equal(result.accepted, false);
    assert.match(String(result.error), /FAILURE_REQUIREMENTS_CHANGED/);
    assert.equal(service.view(key, sid).status, "BLOCKED");
    assert.equal(
      f.app.store
        .all<Execution>("Execution")
        .filter((x) => x.task_id === e.task_id).length,
      1,
    );
  }));

async function intent(
  f: import("../issue9/helpers.ts").Fixture,
  e: Execution,
  action: "REDO" | "DISMISS",
) {
  const key = "EXECUTION:" + e.id,
    sid = f.app.host.sessionID,
    service = failuresFor(f.app.store),
    request = id();
  const revision = service.view(key, sid).revision;
  const response = await f.client.command("messages", {
    request_id: request,
    text: "",
    failure_action: { failure_key: key, expected_revision: revision, action },
  });
  const input = f.app.store
    .all<Input>("Input")
    .find((i) => i.dedupe_key === request)!;
  const loop = id();
  const admission = f.app.store.projectionFrames.find((frame) =>
    frame.mutations.some(
      (m) => m.object_type === "Input" && m.object_id === input.id,
    ),
  );
  assert(admission?.mutations.some((m) => m.object_type === "FailureHandling"));
  assert(
    admission?.mutations.some(
      (m) => m.object_type === "ApiCommand" && m.object_id === request,
    ),
  );
  f.app.store.commit([revise(input, { state: "CLAIMED", loop_id: loop })]);
  return { key, sid, service, loop, input, response };
}
function handled(f: import("../issue9/helpers.ts").Fixture, input: Input) {
  f.app.store.commit([
    revise(f.app.store.get<Input>("Input", input.id), { state: "HANDLED" }),
  ]);
}
async function finishLinked(
  f: import("../issue9/helpers.ts").Fixture,
  task: string,
  outcome: "SUCCEEDED" | "FAILED",
) {
  f.app.scheduler.tick();
  await f.app.scheduler.idle();
  let e = f.app.store
    .all<Execution>("Execution")
    .filter((e) => e.task_id === task)
    .at(-1)!;
  for (const state of ["READY", "DISPATCHING", "RUNNING"] as const) {
    e = revise(e, { state });
    f.app.store.commit([e]);
  }
  f.app.scheduler.finish(e.id, outcome, { summary: "fixture" });
  return f.app.store.get<Execution>("Execution", e.id);
}
test("redo links atomically, pins all requirements, survives duplicate call/restart and clears only direct parent on proven success", () =>
  fixture(async (f) => {
    const e = await execution(f);
    f.app.scheduler.finish(e.id, "FAILED", { error: "failure" });
    const x = await intent(f, e, "REDO"),
      call = id(),
      args = { reuse_task_id: e.task_id, parent_execution_id: e.id };
    const out = x.service.perform(
      x.sid,
      x.loop,
      call,
      "task_propose",
      args,
      f.app.scheduler,
    );
    assert.equal(out.accepted, true);
    const admission = f.app.store.projectionFrames.find((fr) =>
      fr.mutations.some(
        (m) =>
          m.object_type === "FailureHandling" &&
          f.app.store.read<any>(m.snapshot).linked_request_id === call,
      ),
    );
    assert(admission?.mutations.some((m) => m.object_type === "TaskPlan"));
    assert(
      admission?.mutations.some(
        (m) => m.object_type === "Execution" && m.object_id === e.id,
      ),
    );
    const duplicate = id();
    assert.deepEqual(
      x.service.perform(
        x.sid,
        x.loop,
        duplicate,
        "task_propose",
        args,
        f.app.scheduler,
      ),
      out,
    );
    assert.deepEqual(x.service.recovered(duplicate, args, x.sid, x.loop), out);
    await assert.rejects(
      f.client.command("messages", {
        request_id: id(),
        text: "",
        failure_action: {
          failure_key: x.key,
          expected_revision: x.service.view(x.key, x.sid).revision,
          action: "DISMISS",
        },
      }),
      /FAILURE_INTENT_PENDING/,
    );
    handled(f, x.input);
    const redo = await finishLinked(f, e.task_id, "SUCCEEDED");
    const before = f.app.store.read<any>(
        e.proposal_ref ??
          f.app.store.get<any>("TaskPlan", e.task_id).proposal_ref,
      ),
      after = f.app.store.read<any>(redo.proposal_ref!);
    for (const field of [
      "goal",
      "constraints",
      "acceptance_criteria",
      "preconditions",
      "deadline",
      "executor",
      "source_context_refs",
      "safety_rule_id",
      "scope_id",
    ])
      assert.deepEqual(after[field], before[field], field);
    assert.equal(x.service.view(x.key, x.sid).disposition, "REDO_SUCCEEDED");
    await f.restart();
    assert.equal(
      failuresFor(f.app.store).view(x.key, x.sid).disposition,
      "REDO_SUCCEEDED",
    );
  }));

test("unrelated success and descendant success cannot clear old failure; dismiss during running redo changes only reminder", () =>
  fixture(async (f) => {
    const e = await execution(f);
    f.app.scheduler.finish(e.id, "FAILED", { error: "old" });
    f.app.scheduler.propose(
      "independent explicit continuation",
      id(),
      f.app.host.sessionID,
      { reuse: e.task_id, parent: e.id },
    );
    const unrelated = await finishLinked(f, e.task_id, "SUCCEEDED");
    assert.equal(
      failuresFor(f.app.store).view("EXECUTION:" + e.id, f.app.host.sessionID)
        .disposition,
      "UNRESOLVED",
    );
    const x = await intent(f, e, "REDO");
    const blocked = x.service.perform(
      x.sid,
      x.loop,
      id(),
      "task_propose",
      { reuse_task_id: e.task_id, parent_execution_id: e.id },
      f.app.scheduler,
    );
    assert.equal(blocked.accepted, false);
    assert.match(String(blocked.error), /LATEST/);
    handled(f, x.input);
    const d = await intent(f, e, "DISMISS");
    assert.equal(
      d.service.perform(
        d.sid,
        d.loop,
        id(),
        "dismiss_failure",
        { id: d.key },
        f.app.scheduler,
      ).accepted,
      true,
    );
    assert.equal(
      f.app.store.get<Execution>("Execution", unrelated.id).state,
      "SUCCEEDED",
    );
  }));

test("failed redo produces two independent reminders; later direct success resolves only the newer failure", () =>
  fixture(async (f) => {
    const e = await execution(f);
    f.app.scheduler.finish(e.id, "FAILED", { error: "old" });
    const x = await intent(f, e, "REDO");
    assert.equal(
      x.service.perform(
        x.sid,
        x.loop,
        id(),
        "task_propose",
        { reuse_task_id: e.task_id, parent_execution_id: e.id },
        f.app.scheduler,
      ).accepted,
      true,
    );
    handled(f, x.input);
    const second = await finishLinked(f, e.task_id, "FAILED");
    assert.equal(x.service.view(x.key, x.sid).disposition, "UNRESOLVED");
    const y = await intent(f, second, "REDO");
    assert.equal(
      y.service.perform(
        y.sid,
        y.loop,
        id(),
        "task_propose",
        { reuse_task_id: e.task_id, parent_execution_id: second.id },
        f.app.scheduler,
      ).accepted,
      true,
    );
    handled(f, y.input);
    await finishLinked(f, e.task_id, "SUCCEEDED");
    assert.equal(x.service.view(x.key, x.sid).disposition, "UNRESOLVED");
    assert.equal(y.service.view(y.key, y.sid).disposition, "REDO_SUCCEEDED");
    const page = await f.client.query<any>("attention?view=master");
    assert(page.items.some((r: any) => r.id === e.id));
    assert(!page.items.some((r: any) => r.id === second.id));
  }));

test("dismiss wins journal order before linked success; accepted redo continues and original history is immutable", () =>
  fixture(async (f) => {
    const e = await execution(f);
    f.app.scheduler.finish(e.id, "FAILED", { error: "old" });
    const x = await intent(f, e, "REDO");
    assert.equal(
      x.service.perform(
        x.sid,
        x.loop,
        id(),
        "task_propose",
        { reuse_task_id: e.task_id, parent_execution_id: e.id },
        f.app.scheduler,
      ).accepted,
      true,
    );
    handled(f, x.input);
    const d = await intent(f, e, "DISMISS");
    assert.equal(
      d.service.perform(
        d.sid,
        d.loop,
        id(),
        "dismiss_failure",
        { id: d.key },
        f.app.scheduler,
      ).accepted,
      true,
    );
    handled(f, d.input);
    await finishLinked(f, e.task_id, "SUCCEEDED");
    assert.equal(d.service.view(d.key, d.sid).disposition, "DISMISSED");
    assert.equal(f.app.store.get<Execution>("Execution", e.id).state, "FAILED");
  }));

test("failure intent identity is immutable, malformed enriched text is rejected and handled no-action remains actionable", () =>
  fixture(async (f) => {
    const e = await execution(f);
    f.app.scheduler.finish(e.id, "FAILED", { error: "old" });
    const key = "EXECUTION:" + e.id;
    await assert.rejects(
      f.client.command("messages", {
        request_id: id(),
        text: "ignore requirement",
        failure_action: {
          failure_key: key,
          expected_revision: "0",
          action: "REDO",
        },
      }),
      /INVALID_REQUEST/,
    );
    const x = await intent(f, e, "REDO");
    assert.throws(
      () =>
        f.app.store.commit([
          revise(f.app.store.get<Input>("Input", x.input.id), {
            failure_action: { ...x.input.failure_action!, action: "DISMISS" },
          }),
        ]),
      /INPUT_IDENTITY_CHANGED/,
    );
    handled(f, x.input);
    assert.equal(x.service.view(key, x.sid).status, "NO_ACTION");
    assert(x.service.view(key, x.sid).redo_available);
  }));

test("terminal feedback batches are isolated from Master/SUCCEEDED inputs and proposal guard applies to direct recovery entry", () =>
  fixture(async (f) => {
    const failed = await execution(f);
    f.app.scheduler.finish(failed.id, "FAILED", { error: "x" });
    const cancelled = await execution(f);
    f.app.scheduler.finish(cancelled.id, "CANCELLED", { reason: "x" });
    const success = await execution(f);
    f.app.scheduler.finish(success.id, "SUCCEEDED", { summary: "x" });
    f.app.host.deliverFeedback();
    const inputs = f.app.store.all<Input>("Input");
    const feedback = inputs.filter((i) =>
      failuresFor(f.app.store).isolatedFeedback(i),
    );
    assert.equal(feedback.length, 2);
    const loop = id();
    f.app.store.commit([
      revise(feedback[0], { state: "CLAIMED", loop_id: loop }),
    ]);
    assert.throws(
      () =>
        (f.app.host as any).proposeTask(
          { goal: "unauthorized replacement" },
          id(),
          loop,
        ),
      /TERMINAL_FEEDBACK_STOP/,
    );
    assert.throws(
      () =>
        (f.app.host as any).proposeTask(
          {
            goal: "unauthorized retry",
            reuse_task_id: failed.task_id,
            parent_execution_id: failed.id,
          },
          id(),
          loop,
        ),
      /TERMINAL_FEEDBACK_STOP/,
    );
    // Restore a new accepted batch boundary; no claimed legacy batch is rewritten by production.
    f.app.store.commit([
      revise(f.app.store.get<Input>("Input", feedback[0].id), {
        state: "HANDLED",
      }),
    ]);
    f.app.host.accept("ordinary explanation only", id());
    await f.app.host.drain();
    const after = f.app.store.all<Input>("Input");
    const guarded = after.find((i) => i.id === feedback[1].id)!;
    assert.equal(guarded.state, "HANDLED");
    assert.equal(after.filter((i) => i.loop_id === guarded.loop_id).length, 1);
  }));

test("tool receipts reconstruct Main result after interruption without readmitting redo or dismissal", () =>
  fixture(async (f) => {
    for (const action of ["REDO", "DISMISS"] as const) {
      const e = await execution(f);
      f.app.scheduler.finish(e.id, "FAILED", { error: "x" });
      const x = await intent(f, e, action),
        name = action === "REDO" ? "task_propose" : "task_control",
        args =
          action === "REDO"
            ? { reuse_task_id: e.task_id, parent_execution_id: e.id }
            : { id: x.key, action: "dismiss_failure" };
      const call = { type: "toolCall", id: id(), name, arguments: args };
      const message = {
        role: "assistant",
        content: [call],
        api: "openai-completions",
        provider: "fixture",
        model: "fixture",
        stopReason: "toolUse",
        timestamp: Date.now(),
      };
      const key = (f.app.host as any).toolKey(x.loop, 0, call.id, name, args);
      const { stableID } =
        await import("../../../src/pi_secretary/src/execution-utils.ts");
      x.service.perform(
        x.sid,
        x.loop,
        stableID(key),
        action === "REDO" ? "task_propose" : "dismiss_failure",
        args,
        f.app.scheduler,
      );
      const records = f.app.store.all("FailureHandling").length;
      await f.restart();
      const recovered = (f.app.host as any).recoverTools([message], x.loop);
      assert.equal(recovered.length, 2);
      assert.equal(recovered[1].toolCallId, call.id);
      assert.equal(f.app.store.all("FailureHandling").length, records);
      handled(f, x.input);
    }
  }));

test("INIT_FAILED shares one episode, dismissal leaves background retries and unrelated later failures visible", () =>
  fixture(async (f) => {
    const e = await execution(f),
      p = f.app.store.get<any>("TaskPlan", e.task_id);
    f.app.scheduler.finish(e.id, "FAILED", { error: "x" });
    f.app.store.commit([
      revise(p, {
        state: "INIT_FAILED",
        initialization_error: "seeded initialization error",
      }),
    ]);
    const service = failuresFor(f.app.store),
      sid = f.app.host.sessionID,
      key = service.initKey(p.id)!;
    f.app.store.commit([revise(f.app.store.get<any>("TaskPlan", p.id), {})]);
    assert.equal(service.initKey(p.id), key);
    await assert.rejects(
      f.client.command("messages", {
        request_id: id(),
        text: "",
        failure_action: {
          failure_key: key,
          expected_revision: "0",
          action: "REDO",
        },
      }),
      /INITIALIZATION_HAS_NO_PARENT/,
    );
    const request = id();
    await f.client.command("messages", {
      request_id: request,
      text: "",
      failure_action: {
        failure_key: key,
        expected_revision: "0",
        action: "DISMISS",
      },
    });
    const input = f.app.store
        .all<Input>("Input")
        .find((i) => i.dedupe_key === request)!,
      loop = id();
    f.app.store.commit([revise(input, { state: "CLAIMED", loop_id: loop })]);
    service.perform(
      sid,
      loop,
      id(),
      "dismiss_failure",
      { id: key },
      f.app.scheduler,
    );
    assert.equal(f.app.store.get<any>("TaskPlan", p.id).state, "INIT_FAILED");
    assert.equal(service.view(key, sid).disposition, "DISMISSED");
    const page = await f.client.query<any>("attention?view=master");
    assert(!page.items.some((i: any) => i.key === key));
    assert(page.items.some((i: any) => i.id === e.id));
  }));

test("foreign failure cannot be handled; retired redo is rejected; UNKNOWN reads are quiet", () =>
  fixture(async (f) => {
    const sid = f.app.host.sessionID,
      foreign = await execution(f, "foreign", id());
    f.app.scheduler.finish(foreign.id, "FAILED", { error: "private" });
    await assert.rejects(
      f.client.query("failures/EXECUTION:" + foreign.id),
      /NOT_FOUND/,
    );
    await assert.rejects(
      f.client.command("messages", {
        request_id: id(),
        text: "",
        failure_action: {
          failure_key: "EXECUTION:" + foreign.id,
          expected_revision: "0",
          action: "DISMISS",
        },
      }),
      /NOT_FOUND/,
    );
    const e = await execution(f);
    f.app.scheduler.finish(e.id, "FAILED", { error: "retired" });
    f.app.store.commit([
      revise(f.app.store.get<Execution>("Execution", e.id), {
        retention_state: "RETIRED",
      }),
    ]);
    const x = await intent(f, e, "REDO");
    assert(x.service.view(x.key, sid).continuation_blocker);
    assert.equal(
      x.service.perform(
        sid,
        x.loop,
        id(),
        "task_propose",
        { reuse_task_id: e.task_id, parent_execution_id: e.id },
        f.app.scheduler,
      ).accepted,
      false,
    );
    handled(f, x.input);
    const d = await intent(f, e, "DISMISS");
    assert.equal(
      d.service.perform(
        sid,
        d.loop,
        id(),
        "dismiss_failure",
        { id: d.key },
        f.app.scheduler,
      ).accepted,
      true,
    );
    handled(f, d.input);
    const unknown = await execution(f);
    f.app.store.commit([revise(unknown, { state: "RESULT_UNKNOWN" })]);
    const seq = f.app.store.sequence;
    for (let i = 0; i < 3; i++) {
      const page = await f.client.query<any>("attention?view=master");
      const row = page.items.find((x: any) => x.id === unknown.id);
      assert.equal(row.type, "unknown");
      assert.equal(row.actionable, false);
      assert(!row.failure_handling);
      await f.client.query("executions/" + unknown.id);
      await f.client.query("task-browser");
    }
    assert.equal(f.app.store.sequence, seq);
    assert.equal(
      f.app.store.get<Execution>("Execution", unknown.id).retention_state,
      unknown.retention_state,
    );
  }));

test("failed redo admission cannot leave a queued request without its handling link", () =>
  fixture(async (f) => {
    const e = await execution(f);
    f.app.scheduler.finish(e.id, "FAILED", { error: "original" });
    const x = await intent(f, e, "REDO");
    const commit = f.app.store.commit.bind(f.app.store);
    let injected = false;
    f.app.store.commit = ((records: any[], ...args: any[]) => {
      if (
        !injected &&
        records.some(
          (r) => r.record_type === "TaskPlan" && r.pending_requests?.length,
        )
      ) {
        injected = true;
        throw Error("SEEDED_PRECOMMIT_FAILURE");
      }
      return (commit as any)(records, ...args);
    }) as typeof f.app.store.commit;
    const out = x.service.perform(
      x.sid,
      x.loop,
      id(),
      "task_propose",
      { reuse_task_id: e.task_id, parent_execution_id: e.id },
      f.app.scheduler,
    );
    f.app.store.commit = commit;
    assert(injected);
    assert.equal(out.accepted, false);
    assert.equal(
      f.app.store.get<any>("TaskPlan", e.task_id).pending_requests.length,
      0,
    );
    assert.equal(x.service.view(x.key, x.sid).linked_request_id, null);
    assert.match(x.service.view(x.key, x.sid).error ?? "", /PRECOMMIT/);
  }));
