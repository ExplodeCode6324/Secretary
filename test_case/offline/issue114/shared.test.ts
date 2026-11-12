import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture, executions, approve, directory } from "../issue16/helpers.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import { relativePath } from "../../../src/pi_secretary/src/scopes.ts";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { ApplicationService } from "../../../src/pi_secretary/src/application-service.ts";
import { validate } from "../../../src/pi_secretary/src/api/protocol.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import type {
  Execution,
  TaskPlan,
  TaskResult,
} from "../../../src/pi_secretary/src/contracts.ts";

for (const kind of ["AGENT", "PROGRAM"] as const)
  for (const nullScope of [false, true])
    test(`${kind} ${nullScope ? "null" : "omitted"} Scope: API admission, Shared receipts and truthful projections`, () =>
      fixture(async (app, api, root) => {
        const script = path.join(root, "program.mjs");
        fs.writeFileSync(
          script,
          "console.log(JSON.stringify({summary:'done',outcome:'SUCCEEDED',effect:'APPLIED'}));",
        );
        const program =
          kind === "PROGRAM"
            ? app.scheduler.registerProgram(script, "synthetic")
            : null;
        const request = id();
        api.command(api.principal, "task-requests", {
          request_id: request,
          goal: "Shared task",
          ...(nullScope ? { scope_id: null } : {}),
          ...(program ? { program_id: program.id } : {}),
        });
        const p = app.store.all<TaskPlan>("TaskPlan")[0];
        assert.equal(p.scope_id, null);
        assert.equal(app.store.all("Scope").length, 0);
        assert.match(app.scheduler.scopes.promptContext(), /virtual Shared/);
        const receipt = app.scheduler.requestStatus(request)!;
        assert.equal(receipt.scope_kind, "SHARED");
        assert.equal(receipt.scope_name, "Shared");
        assert.equal(receipt.workspace_info.availability, "planned");
        assert.equal(receipt.workspace_info.location, "CORE_HOST");
        assert.equal(
          receipt.workspace_info.path,
          path.join(app.store.dir, "workspaces", p.id, "work"),
        );
        app.scheduler.tick();
        await app.scheduler.idle();
        if (program) {
          approve(app);
          app.scheduler.tick();
          await app.scheduler.idle();
        }
        const e = executions(app)[0];
        assert.equal(e.state, "SUCCEEDED");
        for (const [route, schema] of [
          [`tasks/${p.id}`, "TaskDetail"],
          [`executions/${e.id}`, "Execution"],
        ]) {
          const view: any = await api.query(api.principal, route);
          validate(schema, view);
          validate("Result", view.result);
          assert.equal(view.scope_kind, "SHARED");
          assert.equal((view as any).workspace_info.availability, "verified");
          assert.equal(
            (view as any).workspace_info.path,
            receipt.workspace_info.path,
          );
        }
        const browser: any = await api.query(
          api.principal,
          `task-browser/${p.id}`,
        );
        validate("TaskBrowserDetail", browser);
        assert.equal(
          (browser as any).task.workspace_info.path,
          receipt.workspace_info.path,
        );
        assert.equal((browser as any).task.scope_kind, "SHARED");
        const packet: any = app.scheduler.scopes.packet(
          e,
          receipt.workspace_info.path,
        );
        assert.equal(packet.kind, "SHARED");
        assert.equal(packet.workspace_info.location, "CORE_HOST");
      }));

test("explicit invalid/archived/unavailable Scopes never downgrade; NONE stays named", () =>
  fixture(async (app, _api, root) => {
    for (const scopeID of [id(), ""])
      assert.throws(
        () =>
          app.scheduler.propose("invalid", id(), app.host.sessionID, {
            scopeID,
          }),
        /SCOPE_NOT_FOUND/,
      );
    const none = app.scheduler.scopes.save({ name: "Named", kind: "NONE" });
    const p = app.scheduler.propose("named", id(), app.host.sessionID, {
      scopeID: none.id,
    });
    assert.equal(app.scheduler.scopes.workspaceView(p).scope_kind, "NONE");
    app.scheduler.scopes.archive(none.id, none.revision);
    assert.throws(
      () =>
        app.scheduler.propose("archived", id(), app.host.sessionID, {
          scopeID: none.id,
        }),
      /SCOPE_ARCHIVED/,
    );
    const rootPath = directory(root);
    const dir = app.scheduler.scopes.save({
      name: "External",
      kind: "DIRECTORY",
      root_path: rootPath,
    });
    const external = app.scheduler.propose(
      "external",
      id(),
      app.host.sessionID,
      { scopeID: dir.id },
    );
    assert.equal(
      app.scheduler.scopes.workspaceView(external).workspace_info.path,
      rootPath,
    );
    fs.rmdirSync(rootPath);
    assert.throws(
      () =>
        app.scheduler.propose("missing", id(), app.host.sessionID, {
          scopeID: dir.id,
        }),
      /ENOENT/,
    );
  }));

const write: StreamFn = (m, c, o) => {
  if (
    !JSON.stringify(c.messages.filter((x) => x.role === "system")).includes(
      "TASK_EXECUTOR",
    )
  )
    return fixtureStream(m, c, o);
  const prior = c.messages.filter((x) => x.role === "toolResult");
  if (!prior.length)
    return replyStream(
      [
        {
          type: "toolCall",
          id: "write",
          name: "write",
          arguments: {
            path: "same.txt",
            content: JSON.stringify(c.messages).includes("alpha")
              ? "alpha"
              : "beta",
          },
        },
      ],
      m,
    );
  return replyStream(
    [
      {
        type: "toolCall",
        id: "done",
        name: "submit_result",
        arguments: {
          outcome: "SUCCEEDED",
          summary: "Saved",
          criteria: [{ id: "C1", met: true, evidence: "write receipt" }],
          artifacts: ["same.txt"],
          artifact_descriptions: [
            { path: "same.txt", description: "Synthetic file" },
          ],
          limitations: [],
        },
      },
    ],
    m,
  );
};
test("two populated Shared tasks retain distinct files, bindings and CAS through restart and continuation", () =>
  fixture(async (app, _api, root) => {
    const plans = ["alpha", "beta"].map((goal) =>
      app.scheduler.propose(goal, id(), app.host.sessionID),
    );
    app.scheduler.tick();
    await app.scheduler.idle();
    const before = executions(app);
    assert(before.every((e) => e.state === "SUCCEEDED"));
    const paths = before.map((e) => e.workspace_binding!.root_path);
    assert.notEqual(paths[0], paths[1]);
    const results = before.map((e) =>
      app.store.get<TaskResult>("TaskResult", e.result_id!),
    );
    const snapshots = before.map((e) => JSON.stringify(e));
    const sid = app.host.sessionID;
    await app.close();
    const reopened = await App.open(path.join(root, "data"), {
      model: fixtureModel,
      stream: fixtureStream,
    });
    try {
      assert.equal(reopened.host.sessionID, sid);
      for (const [i, p] of plans.entries()) {
        assert.equal(
          JSON.stringify(
            reopened.store.get<Execution>("Execution", before[i].id),
          ),
          snapshots[i],
        );
        const content = i === 0 ? "alpha" : "beta";
        assert.equal(
          fs.readFileSync(path.join(paths[i], "same.txt"), "utf8"),
          content,
        );
        assert.equal(
          reopened.store.bytes(results[i].artifacts[0].content).toString(),
          content,
        );
        reopened.scheduler.propose("Continue", id(), sid, {
          reuse: p.id,
          parent: before[i].id,
        });
      }
      reopened.scheduler.tick();
      await reopened.scheduler.idle();
      for (const [i, p] of plans.entries()) {
        const e = executions(reopened)
          .filter((e) => e.task_id === p.id)
          .at(-1)!;
        assert.equal(e.state, "SUCCEEDED");
        assert.equal(e.workspace_binding!.root_path, paths[i]);
        assert.equal(
          fs.readFileSync(
            relativePath(reopened.scheduler.rootFor(e), "same.txt"),
            "utf8",
          ),
          i === 0 ? "alpha" : "beta",
        );
        assert.throws(
          () =>
            relativePath(
              reopened.scheduler.rootFor(e),
              `../../${plans[1 - i].id}/work/same.txt`,
            ),
          /INVALID_PATH/,
        );
      }
    } finally {
      await reopened.close();
    }
  }, write));

test("missing queued/periodic or historical workspace is diagnosed without empty recreation", () =>
  fixture(async (app, api) => {
    const p = app.scheduler.propose("queued", id(), app.host.sessionID);
    const work = path.join(app.scheduler.workspace, p.id, "work");
    fs.rmdirSync(work);
    app.scheduler.tick();
    await app.scheduler.idle();
    const e = executions(app)[0];
    assert.equal(e.state, "WAIT_PRECONDITION");
    assert.equal(
      e.condition_results.at(-1)?.reason,
      "WORKSPACE_MISSING_OR_UNSAFE",
    );
    assert.equal(fs.existsSync(work), false);
    const view: any = await api.query(api.principal, `executions/${e.id}`);
    assert.equal((view as any).workspace_info.availability, "unavailable");
    assert.equal(
      (view as any).workspace_info.reason,
      "WORKSPACE_MISSING_OR_UNSAFE",
    );
    const legacy = { ...e };
    delete legacy.workspace_binding;
    delete legacy.scope_id;
    assert.throws(
      () => app.scheduler.rootFor(legacy),
      /WORKSPACE_MISSING_OR_UNSAFE/,
    );
    assert.equal(fs.existsSync(work), false);
  }));

test("unsafe roots are never followed during initialization or reported verified", () =>
  fixture(async (app, _api, root) => {
    const p = app.scheduler.propose("unsafe", id(), app.host.sessionID);
    const work = path.join(app.scheduler.workspace, p.id, "work");
    const outside = directory(root, "outside");
    fs.rmdirSync(work);
    fs.symlinkSync(outside, work);
    app.scheduler.tick();
    await app.scheduler.idle();
    const e = executions(app)[0];
    assert.equal(e.state, "WAIT_PRECONDITION");
    assert.equal(
      app.scheduler.scopes.workspaceView(p, e).workspace_info.reason,
      "SYMLINK_REJECTED",
    );
    app.store.commit([
      revise(app.store.get<TaskPlan>("TaskPlan", p.id), {
        state: "INIT_FAILED",
      }),
    ]);
    app.scheduler.initialize(p.id);
    assert.equal(
      app.store.get<TaskPlan>("TaskPlan", p.id).state,
      "INIT_FAILED",
    );
    assert.deepEqual(fs.readdirSync(outside), []);
  }));

for (const kind of ["AGENT", "PROGRAM"] as const)
  for (const nullScope of [false, true])
    test(`Main ${kind} ${nullScope ? "null" : "omitted"} Scope uses Shared with no ordinary Scopes`, async () => {
      let programID: string | undefined;
      let proposed = false;
      const stream: StreamFn = (m, c, o) => {
        const system = JSON.stringify(
          c.messages.filter((x) => x.role === "system"),
        );
        if (!system.includes("Available scopes (data)"))
          return fixtureStream(m, c, o);
        assert.match(system, /virtual Shared/);
        if (!proposed) {
          proposed = true;
          return replyStream(
            [
              {
                type: "toolCall",
                id: id(),
                name: "task_propose",
                arguments: {
                  title_candidate: "Synthetic Shared",
                  goal: "Main Shared task",
                  ...(nullScope ? { scope_id: null } : {}),
                  ...(programID ? { program_id: programID } : {}),
                },
              },
            ],
            m,
          );
        }
        const receipt = c.messages.find((x) => x.role === "toolResult");
        assert.match(JSON.stringify(receipt), /SHARED/);
        assert.match(JSON.stringify(receipt), /CORE_HOST/);
        return replyStream(
          [{ type: "text", text: "Task accepted in Shared on the Core host" }],
          m,
        );
      };
      await fixture(async (app, _api, root) => {
        if (kind === "PROGRAM") {
          const script = path.join(root, "program.mjs");
          fs.writeFileSync(
            script,
            "console.log(JSON.stringify({summary:'done',outcome:'SUCCEEDED',effect:'APPLIED'}));",
          );
          programID = app.scheduler.registerProgram(script, "synthetic").id;
        }
        app.host.accept("Create a task using the default workspace");
        await app.host.drain();
        const p = app.store.all<TaskPlan>("TaskPlan")[0];
        assert.equal(p.scope_id, null);
        assert.equal(p.executor.kind, kind);
        assert.equal(app.store.all("Scope").length, 0);
        const query: any = app.scheduler.query(app.host.sessionID, p.id);
        assert.equal(query.scope_kind, "SHARED");
        assert.equal(query.workspace_info.availability, "planned");
      }, stream);
    });

test("completed and retired tasks keep files; missing continuation is rejected without repair", () =>
  fixture(async (app) => {
    const p = app.scheduler.propose("alpha", id(), app.host.sessionID);
    app.scheduler.tick();
    await app.scheduler.idle();
    const e = executions(app)[0],
      work = e.workspace_binding!.root_path;
    app.scheduler.propose("continue", id(), app.host.sessionID, {
      reuse: p.id,
      parent: e.id,
    });
    fs.renameSync(work, work + "-held");
    app.scheduler.tick();
    await app.scheduler.idle();
    assert.equal(executions(app).length, 1);
    assert.equal(fs.existsSync(work), false);
    assert.throws(
      () =>
        app.scheduler.propose("missing", id(), app.host.sessionID, {
          reuse: p.id,
          parent: e.id,
        }),
      /WORKSPACE_MISSING_OR_UNSAFE/,
    );
    fs.renameSync(work + "-held", work);
    for (const f of app.store.all<any>("Feedback"))
      app.store.commit([revise(f, { state: "HANDLED" })]);
    app.scheduler.retire(Date.now() + 4 * 86400000);
    assert.equal(
      app.store.get<Execution>("Execution", e.id).retention_state,
      "RETIRED",
    );
    assert.equal(fs.readFileSync(path.join(work, "same.txt"), "utf8"), "alpha");
    assert.equal(
      app.scheduler.detail(e.id).workspace_info.availability,
      "verified",
    );
  }, write));
