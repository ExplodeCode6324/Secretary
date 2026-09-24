import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { serve } from "../../../src/pi_secretary/src/backend.ts";
import { api } from "../../../src/pi_secretary/src/ui-client.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import { id, base, now } from "../../../src/pi_secretary/src/store.ts";
import type {
  AuthorizationRequest,
  Input,
  Notification,
} from "../../../src/pi_secretary/src/contracts.ts";
import { renderMessage } from "../../../src/pi_secretary/src/tui.ts";

test("Web and TUI clients share one session, durable inputs and bound approvals", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-dual-ui-"));
  const app = await App.open(dir, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  const backend = await serve(app);
  try {
    const endpoint = backend.endpoint;
    assert.equal((await fetch(endpoint.url + "/api/state")).status, 401);
    assert.equal(
      (
        await fetch(endpoint.url + "/api/health", {
          headers: {
            Authorization: `Bearer ${endpoint.token}`,
            Origin: "https://untrusted.invalid",
          },
        })
      ).status,
      403,
    );
    const tui = (await api(endpoint, "/api/client", {})).client;
    const web = (await api(endpoint, "/api/client", {})).client;
    const request = id();
    await Promise.all([
      api(endpoint, "/api/message", {
        client: web,
        text: "from web",
        request_id: request,
      }),
      api(endpoint, "/api/message", {
        client: web,
        text: "from web",
        request_id: request,
      }),
    ]);
    await api(endpoint, "/api/command", { client: tui, line: "from TUI" });
    await app.host.drain();
    const state = await api(endpoint, "/api/state?client=" + web);
    assert.equal(state.session, app.host.sessionID);
    assert(state.messages.some((m: { text: string }) => m.text === "from TUI"));
    assert.equal(
      app.store
        .all<Input>("Input")
        .filter(
          (i) =>
            i.payload && app.store.bytes(i.payload).toString() === "from web",
        ).length,
      1,
    );
    const poll = await api(endpoint, "/api/poll?client=" + tui);
    assert(
      poll.output.some(
        (o: { text: string; tone: string }) =>
          o.text.includes("from web") && o.tone === "master",
      ),
    );
    const op = app.authorization.prepare(
      { session_id: app.host.sessionID, task_id: null, execution_id: null },
      "file.write",
      "/fixture",
      { content: "test" },
    );
    const grant = app.store.get<AuthorizationRequest>(
      "AuthorizationRequest",
      op.authorization_id!,
    );
    const approval = {
      client: web,
      request_id: id(),
      id: grant.id,
      revision: grant.revision,
      display_hash: grant.display_hash,
      decision: "REJECT",
    };
    await api(endpoint, "/api/approval", approval);
    await assert.rejects(
      api(endpoint, "/api/approval", {
        ...approval,
        request_id: id(),
        decision: "APPROVE",
      }),
      /CONFLICT/,
    );
    assert.equal(
      (await api(endpoint, "/api/state?client=" + tui)).approvals.length,
      0,
    );
    const notice: Notification = {
      record_type: "Notification",
      schema_version: 1,
      ...base(),
      state: "QUEUED",
      session_id: app.host.sessionID,
      channel: "local-ui",
      message: app.store.put("shown in browser", "text/plain"),
      delivery_key: id(),
      receipt: null,
      requested_at: now(),
    };
    app.store.commit(
      [notice],
      [app.store.event("notification.queued", notice)],
    );
    const page = await api(endpoint, "/api/state?client=" + web);
    assert(page.notification_ids.includes(notice.id));
    assert.equal(
      app.store.get<Notification>("Notification", notice.id).state,
      "QUEUED",
    );
    await api(endpoint, "/api/presented", { client: web, ids: [notice.id] });
    assert.equal(
      app.store.get<Notification>("Notification", notice.id).state,
      "SENT",
    );
    assert.equal(
      (await api(endpoint, "/api/presented", { client: web, ids: [notice.id] }))
        .presented,
      0,
    );
    const html = await (await fetch(endpoint.url)).text();
    assert(html.includes('id="composer"'));
    assert.match(renderMessage("test", "master", true), /\x1b\[38;5;223m/);
    assert.equal(renderMessage("test\x1b[2J", "master", false), "test");
  } finally {
    await backend.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
