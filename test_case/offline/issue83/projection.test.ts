import test from "node:test";
import assert from "node:assert/strict";
import { fixture, executions } from "../issue16/helpers.ts";
import { id, revise, base } from "../../../src/pi_secretary/src/store.ts";
import { validate } from "../../../src/pi_secretary/src/api/protocol.ts";
import type {
  TaskBrowserPage,
  TaskBrowserDetail,
  TaskBrowserMessages,
  Message,
} from "../../../src/pi_secretary/src/api/contracts.ts";
import type {
  TaskPlan,
  Execution,
} from "../../../src/pi_secretary/src/contracts.ts";

const q = (v: Record<string, string> = {}) => new URLSearchParams(v);
test("whole-set counts and ordering; immutable creation time; history never inflates counts; archive prefix exclusion", () =>
  fixture(async (a, api) => {
    const scopes = Array.from({ length: 4 }, (_, i) =>
      a.scheduler.scopes.save({ name: "Scope " + i, kind: "NONE" }),
    );
    const plans = scopes.map((s) =>
      a.scheduler.propose("scheduled " + s.name, id(), a.host.sessionID, {
        scopeID: s.id,
        at: "2099-01-01T00:00:00.000Z",
      }),
    );
    for (let i = 0; i < 3; i++)
      a.scheduler.propose("Shared " + i, id(), a.host.sessionID, {
        at: "2099-01-01T00:00:00.000Z",
      });
    for (let i = 0; i < 2; i++) {
      const s = a.scheduler.scopes.save({ name: "archive " + i, kind: "NONE" });
      a.scheduler.scopes.archive(s.id, s.revision);
    }
    const first = (await api.query(
      api.principal,
      "task-browser",
      q({ limit: "2" }),
    )) as TaskBrowserPage;
    validate("TaskBrowserPage", first);
    assert.deepEqual(first.counts, {
      scopes: 4,
      archived_scopes: 2,
      shared_tasks: 3,
    });
    const all = [...first.items];
    let cursor = first.after;
    while (cursor) {
      const p = (await api.query(
        api.principal,
        "task-browser",
        q({ limit: "2", cursor }),
      )) as TaskBrowserPage;
      all.push(...p.items.filter((i) => !i.id.startsWith("continued:")));
      cursor = p.after;
    }
    assert.equal(all.filter((i) => i.kind === "task").length, 7);
    a.scheduler.scopes.save(
      { description: "unrelated edit" },
      scopes[0].id,
      scopes[0].revision,
    );
    const again = (await api.query(
      api.principal,
      "task-browser",
      q({ limit: "2" }),
    )) as TaskBrowserPage;
    assert.equal(first.generation, again.generation);
    const p = a.store.get<TaskPlan>("TaskPlan", plans[0].id);
    a.store.commit([revise(p, { state: "PAUSED" })]);
    const located = (await api.query(
      api.principal,
      "task-browser/locate",
      q({ task_id: p.id, match: "exact" }),
    )) as TaskBrowserPage;
    assert.equal(located.historical?.state, "PAUSED");
    assert.equal(located.counts.scopes, 3);
    const detail = (await api.query(
      api.principal,
      "task-browser/" + p.id,
    )) as TaskBrowserDetail;
    validate("TaskBrowserDetail", detail);
    const s = a.scheduler.scopes.get(scopes[0].id);
    a.scheduler.scopes.archive(s.id, s.revision);
    await assert.rejects(
      api.query(api.principal, "task-browser/" + p.id),
      /TASK_NOT_BROWSABLE/,
    );
    const suggestions = (await api.query(
      api.principal,
      "task-browser/locate",
      q({ task_id: p.id, match: "prefix", suggest: "true" }),
    )) as TaskBrowserPage;
    assert.deepEqual(suggestions.suggestions, []);
  }));
test("real Agent events, latest three, duplicate messages preserved, long content and CoT pages read-only", () =>
  fixture(async (a, api) => {
    const p = a.scheduler.propose("history", id(), a.host.sessionID);
    for (let i = 0; i < 4; i++) {
      if (i)
        a.scheduler.propose("continue " + i, id(), a.host.sessionID, {
          reuse: p.id,
          parent: executions(a).at(-1)!.id,
        });
      a.scheduler.tick();
      await a.scheduler.idle();
    }
    const es = executions(a);
    assert.equal(es.length, 4);
    const last = es.at(-1)!;
    const raw = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "真实推理".repeat(3000) },
        { type: "thinking", thinking: "SECRET", redacted: true },
        { type: "text", text: "same 😀正文".repeat(4000) },
      ],
    };
    const events = [
      a.store.event(
        "agent.message",
        raw,
        { session_id: null, task_id: p.id, execution_id: last.id },
        "EXECUTOR",
      ),
      a.store.event(
        "agent.message",
        raw,
        { session_id: null, task_id: p.id, execution_id: last.id },
        "EXECUTOR",
      ),
    ];
    a.store.commit([], events);
    const sequence = a.store.sequence;
    const detail = (await api.query(
      api.principal,
      "task-browser/" + p.id,
    )) as TaskBrowserDetail;
    assert.equal(detail.executions.length, 3);
    assert.equal(detail.executions[0].id, last.id);
    const route = `task-browser/${p.id}/executions/${last.id}/messages`;
    const page = (await api.query(
      api.principal,
      route,
      q({ thinking: "true" }),
    )) as TaskBrowserMessages;
    validate("TaskBrowserMessages", page);
    assert.ok(events.every((e) => page.items.some((m) => m.id === e.event_id)));
    let msg = (await api.query(
      api.principal,
      route + "/" + events[0].event_id + "/content",
      q({ thinking: "true" }),
    )) as Message;
    let text = msg.text,
      thought = msg.thinking ?? "";
    while (msg.next_cursor) {
      msg = (await api.query(
        api.principal,
        route + "/" + events[0].event_id + "/content",
        q({ thinking: "true", cursor: msg.next_cursor }),
      )) as Message;
      text += msg.text;
      thought += msg.thinking ?? "";
    }
    assert.equal(text, raw.content[2].text);
    assert.equal(thought, raw.content[0].thinking);
    assert.equal(a.store.sequence, sequence);
    await assert.rejects(
      api.query(
        api.principal,
        `task-browser/${p.id}/executions/${es[0].id}/messages`,
      ),
      /EXECUTION_OUTSIDE_RECENT_THREE/,
    );
    const current = (await api.query(
      api.principal,
      "task-browser",
    )) as TaskBrowserPage;
    assert.equal(current.counts.shared_tasks, 0);
    a.store.commit([
      {
        ...a.store.get<Execution>("Execution", last.id),
        ...base(),
        state: "FAILED",
        retention_state: "RETIRED",
      },
    ]);
    assert.equal(
      ((await api.query(api.principal, "task-browser")) as TaskBrowserPage)
        .counts.shared_tasks,
      1,
    );
  }));

test("A1 full 4/3/2 dataset orders active groups by invocation and inactive groups by creation across all pages", () =>
  fixture(async (a, api) => {
    const wait = () => new Promise((r) => setTimeout(r, 3));
    const scopes = [];
    for (const name of ["A", "B", "C", "D"]) {
      scopes.push(a.scheduler.scopes.save({ name, kind: "NONE" }));
      await wait();
    }
    for (const s of scopes.slice(0, 2)) {
      a.scheduler.propose("active " + s.name, id(), a.host.sessionID, {
        scopeID: s.id,
        preconditions: [
          {
            condition_id: id(),
            kind: "RESOURCE_PRESENT",
            target: "missing",
            required_revision: null,
          },
        ],
      });
      a.scheduler.tick();
      await a.scheduler.idle();
      await wait();
    }
    for (const s of scopes.slice(2))
      a.scheduler.propose("scheduled " + s.name, id(), a.host.sessionID, {
        scopeID: s.id,
        at: "2099-01-01T00:00:00.000Z",
      });
    for (let i = 0; i < 3; i++)
      a.scheduler.propose("Shared " + i, id(), a.host.sessionID, {
        at: "2099-01-01T00:00:00.000Z",
      });
    for (let i = 0; i < 2; i++) {
      const s = a.scheduler.scopes.save({ name: "archive " + i, kind: "NONE" });
      a.scheduler.scopes.archive(s.id, s.revision);
    }
    const empty = a.scheduler.scopes.save({ name: "empty", kind: "NONE" });
    assert(empty);
    const first = (await api.query(
      api.principal,
      "task-browser",
      q({ limit: "1" }),
    )) as TaskBrowserPage;
    assert.deepEqual(first.counts, {
      scopes: 4,
      archived_scopes: 2,
      shared_tasks: 3,
    });
    const names: string[] = [];
    let cursor: string | null = null;
    do {
      const p = (await api.query(
        api.principal,
        "task-browser",
        q({ limit: "1", ...(cursor ? { cursor } : {}) }),
      )) as TaskBrowserPage;
      for (const r of p.items)
        if (r.kind === "group" && !r.id.startsWith("continued:"))
          names.push(r.group.name);
      cursor = p.after;
    } while (cursor);
    assert.deepEqual(names, ["B", "A", "D", "C", "Shared"]);
    a.scheduler.scopes.save(
      { description: "updated after D, still created before D" },
      scopes[2].id,
      scopes[2].revision,
    );
    const after = (await api.query(
      api.principal,
      "task-browser",
      q({ limit: "1" }),
    )) as TaskBrowserPage;
    assert.equal(after.generation, first.generation);
  }));

test("real pending and approved authorization on ended execution keeps attention and Task current", () =>
  fixture(async (a, api, root) => {
    const p = a.scheduler.propose(
      "complete before authorization",
      id(),
      a.host.sessionID,
    );
    a.scheduler.tick();
    await a.scheduler.idle();
    const e = executions(a)[0];
    assert.equal(e.state, "SUCCEEDED");
    const op = a.authorization.prepare(
      { session_id: null, task_id: p.id, execution_id: e.id },
      "file.write",
      root + "/report.txt",
      { path: "report.txt", content: "bounded test" },
      id(),
      null,
    );
    assert(op.authorization_id);
    let request = a.store.get<
      import("../../../src/pi_secretary/src/contracts.ts").AuthorizationRequest
    >("AuthorizationRequest", op.authorization_id);
    let detail = (await api.query(
      api.principal,
      "task-browser/" + p.id,
    )) as TaskBrowserDetail;
    assert(detail.task.current_reasons.includes("attention"));
    assert(detail.task.attention_ids.includes(request.id));
    a.authorization.decide({
      schema_version: 1,
      record_type: "ApprovalCommand",
      request_id: id(),
      authorization_id: request.id,
      expected_revision: request.revision,
      display_hash: request.display_hash,
      decision: "APPROVE",
    });
    request = a.store.get("AuthorizationRequest", request.id);
    assert.equal(request.state, "APPROVED");
    detail = (await api.query(
      api.principal,
      "task-browser/" + p.id,
    )) as TaskBrowserDetail;
    assert(detail.task.current_reasons.includes("attention"));
    const attention = (await api.query(api.principal, "attention")) as {
      items: { id: string }[];
    };
    assert(attention.items.some((r) => r.id === request.id));
  }));
