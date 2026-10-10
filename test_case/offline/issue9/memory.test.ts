import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentText } from "@earendil-works/pi-ai";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { base, id, now, revise } from "../../../src/pi_secretary/src/store.ts";
import { ApplicationService } from "../../../src/pi_secretary/src/application-service.ts";
import { NotificationService } from "../../../src/pi_secretary/src/notification-service.ts";
import { emptySettings } from "../../../src/pi_secretary/src/settings-payload.ts";
import { getInstructions } from "../../../src/pi_secretary/src/instructions.ts";
import { reconcileCommitments } from "../../../src/pi_secretary/src/memory.ts";
import {
  fixtureModel,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import type {
  Consciousness,
  Context,
  Notification,
  TaskResult,
  CompactionJob,
} from "../../../src/pi_secretary/src/contracts.ts";

const promise = "收到执行结果后汇报；不轮询运行中任务";
const memory = (app: App) =>
  app.store.get<Consciousness>(
    "Consciousness",
    app.host.session.consciousness_id,
  );
async function fixture(
  body: (f: {
    app: App;
    reopen: () => Promise<App>;
    result: TaskResult;
    propose: (eventID: string) => void;
  }) => Promise<void>,
) {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "secretary-issue3-commitment-"),
  );
  const taskID = id(),
    executionID = id();
  let resolution: string | null = null;
  const stream: StreamFn = (model, context) => {
    const system = contentText(context.messages[0].content);
    const packet = JSON.parse(
      system.includes("CONSCIOUSNESS:") ||
        system.includes("COMMITMENT_EXTRACTION:")
        ? contentText(context.messages.at(-1)!.content)
        : "{}",
    );
    const answer = system.includes("COMMITMENT_EXTRACTION:")
      ? JSON.stringify({
          quotes: packet.source
            .filter((m: { text: string }) => m.text.endsWith(promise))
            .map((m: { text: string }) => m.text),
        })
      : system.includes("CONSCIOUSNESS:")
        ? JSON.stringify({
            items: [
              {
                tier: "ACTIVE",
                summary: "Synthetic result reporting",
                goals: [],
                constraints: [],
                decisions: [],
                open_questions: [],
                unfulfilled_commitments: [],
                task_refs: [taskID],
                pending_owner: "MAIN",
              },
            ],
            resolutions: resolution
              ? packet.commitments.map((c: { id: string }) => ({
                  id: c.id,
                  event_id: resolution,
                }))
              : [],
          })
        : promise;
    return replyStream([{ type: "text", text: answer }], model);
  };
  let app = await App.open(dir, { model: fixtureModel, stream });
  try {
    const evidence = app.store.put(
      "Synthetic task result evidence",
      "text/plain",
    );
    const result: TaskResult = {
      schema_version: 1,
      record_type: "TaskResult",
      ...base(),
      task_id: taskID,
      execution_id: executionID,
      outcome: "SUCCEEDED",
      summary: "Synthetic report complete",
      limitations: [],
      evidence: [evidence],
      artifacts: [],
      detail_ref: evidence,
      needs_action: false,
      verified_by: "PROGRAM_CHECK",
      observed_at: now(),
    };
    app.store.commit([result]);
    await body({
      app,
      result,
      propose: (eventID) => {
        resolution = eventID;
      },
      reopen: async () => {
        await app.close();
        app = await App.open(dir, { model: fixtureModel, stream });
        return app;
      },
    });
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
async function introduce(app: App) {
  app.host.accept("Acknowledge the synthetic reporting obligation.");
  await app.host.drain();
  await app.host.compact();
  assert.equal(app.host.memoryStatus().state, "COMMITTED");
  assert.equal(memory(app).commitments?.[0].state, "OPEN");
}

test("N05: received cannot fulfill reporting promise; authentic presented fulfills and survives read/restart", async () => {
  await fixture(async ({ app, result, propose, reopen }) => {
    const svc = new ApplicationService(app),
      cmd = (route: string, body: any, binding?: string) =>
        svc.command(svc.principal, route, body, binding);
    cmd("sync/initialize", { request_id: id() });
    const client = cmd("clients", {
      request_id: id(),
      name: "Synthetic memory client",
    }).resource_ids.find((r) => r.type === "ClientRegistration")!.id;
    cmd("clients/" + client + "/notification-target", {
      request_id: id(),
      enabled: true,
    });
    const binding = svc.synchronization.notifications.binding(
      client,
      svc.identity.owner_id,
    );
    await introduce(app);
    const n = new NotificationService(app.store).create(
      app.host.sessionID,
      `${result.task_id}: ${result.outcome}`,
      id(),
    );
    const d = app.store.all("NotificationDelivery")[0];
    cmd(
      "deliveries/" + d.id + "/ack",
      { request_id: id(), kind: "received", content_version: n.message.sha256 },
      binding,
    );
    const queued = app.store.logs.findLast(
      (e) => e.event_type === "notification.queued",
    )!;
    propose(queued.event_id);
    app.host.accept("Synthetic received-only check.");
    await app.host.drain();
    await app.host.compact();
    assert.equal(memory(app).commitments?.[0].state, "OPEN");
    cmd(
      "deliveries/" + d.id + "/ack",
      {
        request_id: id(),
        kind: "presented",
        content_version: n.message.sha256,
      },
      binding,
    );
    const presented = app.store.logs.findLast(
      (e) => e.event_type === "notification.presented",
    )!;
    cmd(
      "deliveries/" + d.id + "/ack",
      { request_id: id(), kind: "read", content_version: n.message.sha256 },
      binding,
    );
    propose(presented.event_id);
    app.host.accept("Synthetic genuine presentation check.");
    await app.host.drain();
    await app.host.compact();
    assert.equal(memory(app).commitments?.[0].state, "COMPLETED");
    assert.deepEqual(memory(app).commitments?.[0].resolution_event_ids, [
      presented.event_id,
    ]);
    await svc.close();
    app = await reopen();
    assert.equal(memory(app).commitments?.[0].state, "COMPLETED");
  });
});
