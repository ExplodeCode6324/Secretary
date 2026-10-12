import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { ApplicationService } from "../../../src/pi_secretary/src/application-service.ts";
import { base, id, now, revise } from "../../../src/pi_secretary/src/store.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import type {
  Execution,
  Operation,
  Feedback,
} from "../../../src/pi_secretary/src/contracts.ts";
import { interrupted } from "./helpers.ts";
async function fixture(
  run: (app: App, service: ApplicationService, dir: string) => Promise<void>,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resolution-test-"));
  const app = await App.open(dir, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  try {
    await run(app, new ApplicationService(app), dir);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
for (const outcome of [
  "APPLIED",
  "NOT_APPLIED",
  "PARTIAL",
  "UNVERIFIED",
] as const)
  test(`owner resolution ${outcome} is durable, replayable and produces one failure result`, () =>
    fixture(async (app, api) => {
      const { e, op } = interrupted(app);
      const body = {
        request_id: id(),
        expected_revision: String(op.revision),
        outcome,
        note: "Synthetic operator observation",
      };
      const receipt = api.command(
        api.principal,
        `operations/${op.id}/resolve`,
        body,
      );
      assert.deepEqual(
        api.command(api.principal, `operations/${op.id}/resolve`, body),
        receipt,
      );
      const resolved = app.store.get<Operation>("Operation", op.id);
      assert.equal(
        resolved.state,
        outcome === "APPLIED" ? "SUCCEEDED" : "FAILED",
      );
      assert.equal(
        resolved.effect,
        outcome === "UNVERIFIED" ? "UNKNOWN" : outcome,
      );
      const value = app.store.read<any>(resolved.receipt!);
      assert.equal(value.original_receipt.sha256, op.receipt!.sha256);
      assert.equal(value.resolved_by, "MASTER_UI");
      assert.equal(app.store.get<Execution>("Execution", e.id).state, "FAILED");
      app.scheduler.settleUnknownExecution(e.id);
      await app.scheduler.recover();
      assert.equal(
        app.store
          .all<Feedback>("Feedback")
          .filter((f) => f.execution_id === e.id && f.kind === "RESULT").length,
        1,
      );
      const view: any = await api.query(api.principal, `operations/${op.id}`);
      assert.equal(view.resolution.outcome, outcome);
      assert.equal(view.process, undefined);
      assert.throws(
        () =>
          api.command(api.principal, `operations/${op.id}/resolve`, {
            ...body,
            note: "different",
          }),
        /REQUEST_CONFLICT/,
      );
      assert.throws(
        () =>
          api.command(api.principal, `operations/${op.id}/resolve`, {
            ...body,
            request_id: id(),
          }),
        /REVISION_CONFLICT/,
      );
      assert.throws(
        () =>
          api.command(api.principal, `operations/${op.id}/resolve`, {
            ...body,
            request_id: id(),
            expected_revision: String(resolved.revision),
          }),
        /OPERATION_NOT_UNKNOWN/,
      );
    }));
test("unknown shell/program blocks only its execution; file identity still blocks across executions", () =>
  fixture(async (app) => {
    const { e, op } = interrupted(app);
    assert.throws(
      () => app.authorization.prepare(op.scope, "program.run", "other", {}),
      /RELATED_EFFECT_UNKNOWN/,
    );
    const other = interrupted(app, "file.write", "/synthetic/blocked-file");
    assert.doesNotThrow(() =>
      app.authorization.prepare(
        other.op.scope,
        "shell.run",
        op.action.resource,
        {},
      ),
    );
    assert.throws(
      () =>
        app.authorization.prepare(
          op.scope,
          "file.write",
          other.op.action.resource,
          {},
        ),
      /RELATED_EFFECT_UNKNOWN/,
    );
    assert.equal(
      app.store.get<Execution>("Execution", e.id).state,
      "RESULT_UNKNOWN",
    );
  }));
test("resolution cannot release an unconfirmed process and partial resolution retains remaining operations", () =>
  fixture(async (app, api) => {
    const { e, op } = interrupted(
      app,
      "shell.run",
      "/synthetic/project",
      false,
    );
    api.command(api.principal, `operations/${op.id}/resolve`, {
      request_id: id(),
      expected_revision: String(op.revision),
      outcome: "UNVERIFIED",
      note: "Cannot verify effect",
    });
    assert.equal(
      app.store.get<Execution>("Execution", e.id).state,
      "RESULT_UNKNOWN",
    );
    assert.equal(app.scheduler.processStopped(e.id), false);
    const current = app.store.get<Operation>("Operation", op.id);
    app.store.commit([
      revise(current, { process: { ...current.process!, state: "STOPPED" } }),
    ]);
    app.scheduler.settleUnknownExecution(e.id);
    assert.equal(app.store.get<Execution>("Execution", e.id).state, "FAILED");
  }));

test("legacy unknown process without identity remains occupied after resolution", () =>
  fixture(async (app, api) => {
    const { e, op } = interrupted(app);
    const { process: _, ...legacy } = op;
    app.store.commit([revise(legacy, {})]);
    const current = app.store.get<Operation>("Operation", op.id);
    api.command(api.principal, `operations/${op.id}/resolve`, {
      request_id: id(),
      expected_revision: String(current.revision),
      outcome: "UNVERIFIED",
      note: "Legacy evidence unavailable",
    });
    assert.equal(app.scheduler.processStopped(e.id), false);
    await app.scheduler.recover();
    await app.scheduler.recover();
    assert.equal(
      app.store.get<Execution>("Execution", e.id).state,
      "RESULT_UNKNOWN",
    );
    assert.equal(app.store.all("Notification").length, 1);
  }));

test("resolving one of several unknown effects preserves the remaining operation", () =>
  fixture(async (app, api) => {
    const { e, op } = interrupted(app);
    const second = {
      ...op,
      ...base(),
      process: undefined,
      action: {
        ...op.action,
        action: "file.write",
        resource: "/synthetic/second",
      },
    };
    delete second.process;
    app.store.commit([second]);
    api.command(api.principal, `operations/${op.id}/resolve`, {
      request_id: id(),
      expected_revision: String(op.revision),
      outcome: "APPLIED",
      note: "Observed",
    });
    assert.equal(
      app.store.get<Execution>("Execution", e.id).state,
      "RESULT_UNKNOWN",
    );
    assert.deepEqual(
      app.store.get<Execution>("Execution", e.id).unknown_operation_ids,
      [second.id],
    );
    api.command(api.principal, `operations/${second.id}/resolve`, {
      request_id: id(),
      expected_revision: String(second.revision),
      outcome: "NOT_APPLIED",
      note: "Observed",
    });
    assert.equal(app.store.get<Execution>("Execution", e.id).state, "FAILED");
  }));

test("operations pagination reads only receipts on the requested page", () =>
  fixture(async (app, api, dir) => {
    const first = interrupted(app).op;
    const second = interrupted(app).op;
    const receipt = app.store.put({ synthetic: "off-page receipt" });
    app.store.commit([revise(second, { receipt })]);
    const file = path.join(dir, "objects", receipt.sha256);
    const bytes = fs.readFileSync(file);
    fs.writeFileSync(file, "corrupt");
    try {
      const page: any = await api.query(
        api.principal,
        "operations",
        new URLSearchParams({ limit: "1" }),
      );
      assert.equal(page.items.length, 1);
      assert.equal(page.items[0].id, first.id);
      assert(page.next_cursor);
      await assert.rejects(() =>
        api.query(
          api.principal,
          "operations",
          new URLSearchParams({ limit: "1", cursor: page.next_cursor }),
        ),
      );
    } finally {
      fs.writeFileSync(file, bytes);
    }
  }));
