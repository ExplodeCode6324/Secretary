import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture, executions } from "../issue16/helpers.ts";
import { id, revise, base } from "../../../src/pi_secretary/src/store.ts";
import type {
  TaskResult,
  Input,
  Feedback,
} from "../../../src/pi_secretary/src/contracts.ts";
import {
  deliveryEvent,
  deliveryCandidates,
} from "../../../src/pi_secretary/src/artifact-delivery.ts";
import { messageIdentityHash } from "../../../src/pi_secretary/src/message-identity.ts";
import type {
  MessageArtifactPage,
  Timeline,
} from "../../../src/pi_secretary/src/api/contracts.ts";
import { validate } from "../../../src/pi_secretary/src/api/protocol.ts";

test("claimed result sidecar is atomic, ID-only, paginated, read-only, replayable and preserves message identity", () =>
  fixture(async (a, api) => {
    a.scheduler.propose("result fixture", id(), a.host.sessionID);
    a.scheduler.tick();
    await a.scheduler.idle();
    const e = executions(a)[0],
      original = a.store.get<TaskResult>("TaskResult", e.result_id!);
    const artifacts = Array.from({ length: 32 }, (_, i) => ({
      artifact_id: id(),
      name: `${i}.txt`,
      workspace_path: `${i}.txt`,
      content: a.store.put("snapshot", "text/plain"),
      producing_operation_id: null,
      description: "界".repeat(2000),
    }));
    const result = { ...original, ...base(), artifacts };
    const originalFeedback = a.store
      .all<Feedback>("Feedback")
      .find((f) => f.result_id === original.id)!;
    const feedback = {
      ...originalFeedback,
      ...base(),
      result_id: result.id,
      input_id: null,
    };
    a.store.commit([result, feedback]);
    fs.writeFileSync(
      path.join(e.workspace_binding!.root_path, "0.txt"),
      "current",
    );
    a.host.deliverFeedback();
    const input = a.store
      .all<Input>("Input")
      .find((i) => i.feedback_id === feedback.id)!;
    const loop = id();
    a.store.commit([revise(input, { state: "CLAIMED", loop_id: loop })]);
    assert.equal(deliveryCandidates(a.store, [input], loop).length, 32);
    assert.equal(deliveryCandidates(a.store, [input], id()).length, 0);
    for (const reason of ["toolUse", "error", "aborted"]) {
      const body = { role: "assistant", content: [], stopReason: reason };
      const ev = a.store.event(
        "main.message",
        body,
        { session_id: a.host.sessionID, task_id: null, execution_id: null },
        "MAIN",
      );
      assert.equal(deliveryEvent(a.store, ev, body, [input], loop).length, 0);
    }
    const body: any = {
      role: "assistant",
      content: [],
      stopReason: "length",
      timestamp: 1,
    };
    const before = messageIdentityHash(body),
      call = id();
    const message = a.store.event(
      "main.message",
      { ...body, display_call_id: call },
      { session_id: a.host.sessionID, task_id: null, execution_id: null },
      "MAIN",
    );
    const sidecars = deliveryEvent(a.store, message, body, [input], loop, call);
    assert.equal(sidecars.length, 1);
    a.store.commit([], [message, ...sidecars]);
    const frame = a.store.projectionFrames.at(-1)!;
    assert.deepEqual(
      frame.log_records.map((e) => e.event_type),
      ["main.message", "main.delivery"],
    );
    const payload: any = a.store.read(sidecars[0].payload);
    assert.deepEqual(Object.keys(payload.artifacts[0]).sort(), [
      "artifact_id",
      "execution_id",
      "result_id",
      "task_id",
    ]);
    assert.equal(messageIdentityHash(a.store.read(message.payload)), before);
    assert.equal(
      deliveryEvent(a.store, message, body, [input], loop, call).length,
      0,
    );
    const q = async (route: string, query = new URLSearchParams()) =>
      api.query(api.principal, route, query);
    const timeline = (await q("timeline")) as Timeline;
    const row = timeline.items.find((m) => m.id === "message:" + call)!;
    assert.equal(row.kind, "message");
    assert.equal((row as any).delivery_count, 32);
    assert.equal((row as any).outcome, "truncated");
    const sequence = a.store.sequence,
      seen: string[] = [];
    let cursor: string | null = null,
      pages = 0;
    do {
      const page = (await q(
        "messages/message:" + call + "/artifacts",
        new URLSearchParams(cursor ? { cursor } : {}),
      )) as MessageArtifactPage;
      validate("MessageArtifactPage", page);
      assert(Buffer.byteLength(JSON.stringify(page)) <= 128 * 1024);
      assert(page.items.length <= 20);
      seen.push(...page.items.map((a) => a.id));
      cursor = page.next_cursor;
      pages++;
    } while (cursor);
    assert.equal(seen.length, 32);
    assert.equal(new Set(seen).size, 32);
    assert(pages >= 2);
    assert.equal(a.store.sequence, sequence);
    const exact: any = await q(
      "artifacts",
      new URLSearchParams({ relative_path: "./0.txt", execution_id: e.id }),
    );
    assert.equal(exact.items.length, 1);
    assert.equal(exact.items[0].current_state, "available");
    assert.equal(exact.items[0].content_version, artifacts[0].content.sha256);
    fs.unlinkSync(path.join(e.workspace_binding!.root_path, "0.txt"));
    const missing: any = await q("artifacts/" + artifacts[0].artifact_id);
    assert.equal(missing.current_state, "unavailable");
    assert.equal(missing.state, "available");
    await assert.rejects(q("messages/" + id() + "/artifacts"));
    await assert.rejects(
      q(
        "messages/message:" + call + "/artifacts",
        new URLSearchParams({ limit: "21" }),
      ),
    );
  }));
