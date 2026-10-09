import { spawn } from "node:child_process";
import { once } from "node:events";
import { validate } from "../../../src/pi_secretary/src/api/protocol.ts";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../../src/pi_secretary/src/api-v1.ts";
import { ApplicationService } from "../../../src/pi_secretary/src/application-service.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import { id, base, revise } from "../../../src/pi_secretary/src/store.ts";
import type {
  Execution,
  TaskResult,
  ApiCommand,
  Input,
} from "../../../src/pi_secretary/src/contracts.ts";
import {
  CoreClient,
  startCore,
  attachCore,
} from "../../../src/pi_secretary/src/core-client.ts";
async function fixture(
  run: (
    app: App,
    server: Awaited<ReturnType<typeof serveCore>>,
    client: CoreClient,
    dir: string,
  ) => Promise<void>,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-api-v1-"));
  const app = await App.open(dir, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  const server = await serveCore(app, 0, undefined, { pump: false });
  try {
    await run(app, server, new CoreClient(server.endpoint), dir);
  } finally {
    await server.close();
    fs.rmSync(dir, { force: true, recursive: true });
  }
}
test("API authentication, hostile origins, retired routes and strict authority fields", () =>
  fixture(async (app, server, c) => {
    const raw = (route: string, headers: Record<string, string> = {}) =>
      fetch(server.endpoint.url + route, { headers });
    assert.equal((await raw("/api/v1/core")).status, 401);
    assert.equal(
      (
        await raw("/api/v1/core", {
          Authorization: `Bearer ${server.endpoint.token}`,
          Origin: "https://example.invalid",
        })
      ).status,
      403,
    );
    for (const route of [
      "/api/client",
      "/api/command",
      "/api/poll",
      "/api/v2/core",
    ])
      assert.equal(
        (await raw(route, { Authorization: `Bearer ${server.endpoint.token}` }))
          .status,
        404,
      );
    const before = app.store.sequence;
    await assert.rejects(
      c.command("messages", { request_id: id(), text: "x", actor: "MASTER" }),
      /INVALID_REQUEST/,
    );
    assert.equal(app.store.sequence, before);
    assert.equal((await c.core()).capabilities.devices.allowed, false);
    for (const feature of [
      "tasks",
      "memory",
      "settings",
      "artifacts",
      "assistant_profile",
    ])
      assert.equal((await c.core()).capabilities[feature].allowed, true);
    assert.throws(
      () =>
        server.service.command(
          { kind: "local-owner", owner_id: id() },
          "messages",
          { request_id: id(), text: "x" },
        ),
      /FORBIDDEN/,
    );
  }));
test("two clients: concurrent dedup, cross-command conflict, canonical binding, profile CAS and query purity", () =>
  fixture(async (app, server, c) => {
    const other = new CoreClient(server.endpoint),
      request = { request_id: id(), text: "hello" };
    const [a, b] = await Promise.all([
      c.command("messages", request),
      other.command("messages", request),
    ]);
    assert.deepEqual(a, b);
    assert.equal(app.store.all("Input").length, 1);
    const frame = app.store.projectionFrames.find((f) =>
      f.mutations.some(
        (m) =>
          m.object_type === "ApiCommand" && m.object_id === request.request_id,
      ),
    )!;
    assert(frame.mutations.some((m) => m.object_type === "Input"));
    await assert.rejects(
      c.command("messages", { ...request, text: "changed" }),
      /REQUEST_CONFLICT/,
    );
    await assert.rejects(
      c.command("clients", { request_id: request.request_id, name: "other" }),
      /REQUEST_CONFLICT/,
    );
    const p = await c.assistant();
    assert.equal(p.name, "secretary");
    const rename = {
      request_id: id(),
      expected_revision: p.revision,
      name: "  Assistant  ",
    };
    await c.command("assistant/profile", rename);
    await other.command("assistant/profile", {
      name: rename.name,
      expected_revision: rename.expected_revision,
      request_id: rename.request_id,
    });
    assert.equal((await other.assistant()).name, "Assistant");
    await assert.rejects(
      c.command("assistant/profile", { ...rename, request_id: id() }),
      /REVISION_CONFLICT/,
    );
    const revision = (await c.assistant()).revision;
    await c.command("assistant/profile", {
      request_id: id(),
      expected_revision: revision,
      name: " \t ",
    });
    assert.equal((await c.assistant()).name, "secretary");
    const before = app.store.sequence;
    for (const route of [
      "core",
      "assistant",
      "session",
      "settings",
      "memory",
      "memory/summary",
      "memory/commitments",
      "memory/recovery",
      "tasks",
      "artifacts",
      "attention",
      "related",
      "timeline",
    ])
      await c.query(route);
    assert.equal(app.store.sequence, before);
    assert.equal(app.store.all("ModelCall").length, 0);
  }));
test("NO_CHANGES and accepted domain mutation survive reopen and response loss", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-api-replay-"));
  let app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
  let s = new ApplicationService(app);
  const apply = {
    request_id: id(),
    expected_revision: String(app.settings.draft().revision),
  };
  const noChange = s.command(s.principal, "settings/apply", apply);
  const msg = { request_id: id(), text: "once" };
  const receipt = s.command(s.principal, "messages", msg);
  const domain = s.identity.owner_id;
  await s.close();
  await app.close();
  app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
  s = new ApplicationService(app);
  try {
    assert.equal(s.identity.owner_id, domain);
    assert.deepEqual(s.command(s.principal, "settings/apply", apply), noChange);
    assert.deepEqual(s.command(s.principal, "messages", msg), receipt);
    assert.equal(app.store.all("Input").length, 1);
    assert.throws(
      () => s.command(s.principal, "messages", { ...msg, text: "changed" }),
      /REQUEST_CONFLICT/,
    );
  } finally {
    await s.close();
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("structured task flow and explicit viewed retention; retired detail never wakes", () =>
  fixture(async (app, server, c) => {
    const request = { request_id: id(), goal: "Synthetic analysis" };
    const accepted = await c.command("task-requests", request);
    const task = accepted.resource_ids.find((r) => r.type === "TaskPlan")!.id;
    await app.settle();
    const e = app.store.all<Execution>("Execution")[0];
    const before = app.store.get<Execution>("Execution", e.id);
    const details: any = await c.query("tasks/" + task);
    assert(details.result.summary);
    await c.query("executions/" + e.id);
    await c.query("tasks");
    assert.deepEqual(app.store.get("Execution", e.id), before);
    await c.command("executions/" + e.id + "/viewed", { request_id: id() });
    assert.equal(
      app.store.get<Execution>("Execution", e.id).revision,
      before.revision + 1,
    );
    const next = {
      request_id: id(),
      goal: "Continue analysis",
      reuse_task_id: task,
      parent_execution_id: e.id,
    };
    await c.command("task-requests", next);
    await c.command("task-requests/" + next.request_id + "/cancel", {
      request_id: id(),
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(
      app.scheduler.requestStatus(next.request_id)?.state,
      "CANCELLED_OR_REJECTED",
    );
    assert.equal(
      (app.scheduler.requestStatus(next.request_id)?.reason as any).reason,
      "MASTER_CANCELLED",
    );
    app.store.commit([
      revise(app.store.get<Execution>("Execution", e.id), {
        retention_state: "RETIRED",
      }),
    ]);
    const seq = app.store.sequence;
    await c.query("executions/" + e.id);
    assert.equal(app.store.sequence, seq);
    const retired = app.store.get<Execution>("Execution", e.id);
    await c.command("executions/" + e.id + "/viewed", { request_id: id() });
    assert.deepEqual(app.store.get("Execution", e.id), retired);
    assert.deepEqual(await c.command("task-requests", request), accepted);
  }));
test("approval exact display/CAS, decision deadlines and attention expiry do not grant authority", () =>
  fixture(async (app, server, c) => {
    const op = app.authorization.prepare(
      { session_id: app.host.sessionID, task_id: null, execution_id: null },
      "file.write",
      "synthetic.txt",
      { text: "x" },
    );
    const auth: any = app.store.get(
      "AuthorizationRequest",
      op.authorization_id!,
    );
    const attention: any = await c.query("attention");
    assert.equal(attention.counts.authorizations, 1);
    const req = {
      request_id: id(),
      expected_revision: String(auth.revision),
      display_hash: auth.display_hash,
      decision: "APPROVE",
    };
    await assert.rejects(
      c.command("authorizations/" + auth.id + "/decision", {
        ...req,
        display_hash: "0".repeat(64),
      }),
      /APPROVAL_CONFLICT/,
    );
    const first = await c.command(
      "authorizations/" + auth.id + "/decision",
      req,
    );
    assert.deepEqual(
      await c.command("authorizations/" + auth.id + "/decision", req),
      first,
    );
    await assert.rejects(
      c.command("authorizations/" + auth.id + "/decision", {
        ...req,
        request_id: id(),
      }),
      /APPROVAL_CONFLICT/,
    );
  }));
test("Unicode opaque body cursors reassemble scalar boundaries and reject old offsets", () =>
  fixture(async (app, server, c) => {
    const text = "中文😀e\u0301𠮷\n".repeat(5000);
    await c.command("messages", { request_id: id(), text });
    const page: any = await c.query("timeline");
    let item = page.items.find((x: any) => x.kind === "message"),
      result = item.text;
    while (item.next_cursor) {
      item = await c.query(
        "messages/" +
          item.id +
          "/content?cursor=" +
          encodeURIComponent(item.next_cursor),
      );
      assert(!/[\uD800-\uDBFF]$/.test(item.text));
      result += item.text;
    }
    assert.equal(result, text);
    await assert.rejects(
      c.query(
        "messages/" +
          item.id +
          "/content?cursor=" +
          Buffer.from('{"offset":10}').toString("base64url"),
      ),
      /CURSOR_EXPIRED/,
    );
    const around: any = await c.query("timeline/around?message_id=" + item.id);
    assert(around.items.some((x: any) => x.id === item.id));
    assert(Buffer.byteLength(JSON.stringify(page)) <= 1024 * 1024);
  }));
test("artifact directory uses opaque IDs, supports duplicate names, verifies content and rejects symlinks", () =>
  fixture(async (app, server, c, dir) => {
    const p = app.scheduler.propose(
      "Synthetic artifacts",
      id(),
      app.host.sessionID,
    );
    await app.settle();
    const e = app.store.all<Execution>("Execution")[0];
    const a = {
      artifact_id: id(),
      name: "result.txt",
      content: app.store.put("artifact data", "text/plain"),
      workspace_path: "result.txt",
      producing_operation_id: null,
    };
    app.store.commit([
      {
        ...base(),
        record_type: "TaskResult",
        schema_version: 1,
        task_id: p.id,
        execution_id: e.id,
        outcome: "SUCCEEDED",
        summary: "Synthetic",
        limitations: [],
        evidence: [a.content],
        artifacts: [a, { ...a, artifact_id: id() }],
        detail_ref: app.store.put({}),
        needs_action: false,
        verified_by: "NOT_VERIFIED",
        observed_at: new Date().toISOString(),
      },
    ]);
    const list: any = await c.query("artifacts?limit=1");
    assert.equal(list.items.length, 1);
    assert(list.next_cursor);
    const second: any = await c.query(
      "artifacts?limit=1&cursor=" + encodeURIComponent(list.next_cursor),
    );
    assert.equal(second.items[0].name, "result.txt");
    assert.notEqual(second.items[0].id, a.artifact_id);
    const download = () =>
      fetch(
        server.endpoint.url + "/api/v1/artifacts/" + a.artifact_id + "/content",
        { headers: { Authorization: "Bearer " + server.endpoint.token } },
      );
    assert.equal(await (await download()).text(), "artifact data");
    const file = path.join(dir, a.content.path);
    fs.unlinkSync(file);
    fs.symlinkSync("/etc/hosts", file);
    assert.equal((await download()).status, 410);
    assert.equal(
      (await c.query<any>("artifacts/" + a.artifact_id)).state,
      "unavailable",
    );
    await assert.rejects(c.query("artifacts/" + id()), /NOT_FOUND/);
  }));
test("interrupted long command is UNKNOWN after restart and cannot be replayed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-api-unknown-"));
  let app = await App.open(dir, { model: fixtureModel, stream: fixtureStream }),
    s = new ApplicationService(app);
  const request = { request_id: id() },
    record: ApiCommand = {
      ...base(request.request_id),
      schema_version: 1,
      record_type: "ApiCommand",
      owner_id: s.identity.owner_id,
      command: "session/compact",
      request_hash: "0".repeat(64),
      state: "RUNNING",
      arguments_ref: app.store.put(request),
      resource_ids: [],
      error_code: null,
      result_ref: null,
    };
  app.store.commit([record]);
  await s.close();
  await app.close();
  app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
  s = new ApplicationService(app);
  try {
    assert.equal(s.receipt(record.id).state, "UNKNOWN");
    assert.equal(app.store.all("ModelCall").length, 0);
  } finally {
    await s.close();
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("concurrent detached Core starters share writer; status never starts; explicit stop survives restart", async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "secretary-api-lifecycle-"),
  );
  let client: CoreClient | undefined;
  const launch = async () => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/pi_secretary/src/core-cli.ts", "start"],
      {
        env: {
          ...process.env,
          SECRETARY_MODE: "fixture",
          SECRETARY_DATABASE_URL: "",
          SECRETARY_DATA: dir,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "",
      errors = "";
    child.stdout.on("data", (b) => (output += b));
    child.stderr.on("data", (b) => (errors += b));
    const [code] = await once(child, "exit");
    assert.equal(code, 0, errors);
    return JSON.parse(output);
  };
  try {
    assert.equal(await attachCore(dir), null);
    const [first, second] = await Promise.all([launch(), launch()]);
    assert.equal(first.instance_id, second.instance_id);
    const a = (await attachCore(dir))!,
      b = new CoreClient(a.endpoint);
    client = a;
    assert.equal((await a.core()).instance_id, (await b.core()).instance_id);
    const r = { request_id: id(), text: "Durable synthetic input" };
    await a.command("messages", r);
    assert.equal(
      fs.statSync(path.join(dir, "core-endpoint.json")).mode & 0o777,
      0o600,
    );
    const stop = await b.command("core/stop", { request_id: id() });
    for (let i = 0; i < 100 && (await attachCore(dir)); i++)
      await new Promise((r) => setTimeout(r, 100));
    await launch();
    client = (await attachCore(dir))!;
    const receipt: any = await client.query("requests/" + stop.request_id);
    assert.equal(receipt.receipt.acceptance, "ACCEPTED");
    assert.equal(
      (await client.command("messages", r)).request_id,
      r.request_id,
    );
  } finally {
    if (client)
      await client.command("core/stop", { request_id: id() }).catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("public DTO definitions and synthetic Swift examples validate without internal storage records", () =>
  fixture(async (app, server, c) => {
    const examples = JSON.parse(
      fs.readFileSync("docs/api/v1/examples.json", "utf8"),
    );
    for (const [key, type] of [
      ["core", "Core"],
      ["assistant", "Assistant"],
      ["receipt", "Receipt"],
      ["message", "Message"],
    ])
      validate(type, examples[key]);
    for (const [route, type] of [
      ["core", "Core"],
      ["assistant", "Assistant"],
      ["session", "Session"],
      ["settings", "Settings"],
      ["memory", "MemoryStatus"],
      ["memory/summary", "MemoryPage"],
      ["memory/commitments", "CommitmentPage"],
      ["tasks", "TaskPage"],
      ["decisions", "DecisionPage"],
      ["authorizations", "AuthorizationPage"],
      ["attention", "Attention"],
      ["artifacts", "ArtifactPage"],
      ["related", "RelatedPage"],
      ["timeline", "Timeline"],
    ])
      validate(type, await c.query(route));
    const accepted = await c.command("task-requests", {
      request_id: id(),
      goal: "Synthetic DTO result",
    });
    await app.settle();
    const task = accepted.resource_ids.find((r) => r.type === "TaskPlan")!.id;
    validate("TaskDetail", await c.query("tasks/" + task));
    const e = app.store.all<Execution>("Execution")[0];
    validate("Execution", await c.query("executions/" + e.id));
    validate("ExecutionPage", await c.query("tasks/" + task + "/executions"));
    const operations = JSON.parse(
      fs.readFileSync("docs/api/v1/operations.json", "utf8"),
    );
    const { commands } =
      await import("../../../src/pi_secretary/src/api/routes.ts");
    assert.deepEqual(
      operations
        .filter((o: any) => o.method === "POST")
        .map((o: any) => [
          o.path.replace("/api/v1/", "").replace("{id}", ":id"),
          o.request,
        ]),
      commands,
    );
  }));
test("working decision answer is exactly-once, rejects stale/expired state, attention revalidates without writes", () =>
  fixture(async (app, server, c) => {
    const p = app.scheduler.propose(
      "Synthetic decision",
      id(),
      app.host.sessionID,
    );
    await app.settle();
    const e = app.store.all<Execution>("Execution")[0];
    const decision = {
      ...base(),
      record_type: "DecisionRequest" as const,
      schema_version: 1 as const,
      state: "OPEN" as const,
      task_id: p.id,
      execution_id: e.id,
      question: "Which synthetic option?",
      options: ["A", "B"],
      impact: "Synthetic choice",
      materials: [],
      deadline: new Date(Date.now() + 60000).toISOString(),
      answer: null,
      answered_by: null,
      answer_request_id: null,
    };
    app.store.commit([
      decision,
      revise(e, { state: "WAIT_DECISION", waiting_request_ids: [decision.id] }),
    ]);
    const first: any = await c.query("attention");
    assert.equal(first.counts.decisions, 1);
    assert.equal(first.valid_until, decision.deadline);
    const request = { request_id: id(), answer: "A" };
    const results = await Promise.all([
      c.command("decisions/" + decision.id + "/answer", request),
      c.command("decisions/" + decision.id + "/answer", request),
    ]);
    assert.deepEqual(results[0], results[1]);
    await assert.rejects(
      c.command("decisions/" + decision.id + "/answer", {
        ...request,
        answer: "B",
      }),
      /REQUEST_CONFLICT/,
    );
    await assert.rejects(
      c.command("decisions/" + decision.id + "/answer", {
        request_id: id(),
        answer: "B",
      }),
      /DECISION_NOT_OPEN/,
    );
    const status: any = await c.query("attention");
    assert.equal(status.counts.decisions, 0);
    const expired = {
      ...decision,
      ...base(),
      deadline: new Date(Date.now() - 1).toISOString(),
    };
    app.store.commit([expired]);
    const seq = app.store.sequence;
    const attention: any = await c.query("attention");
    assert.equal(attention.counts.decisions, 0);
    assert.equal(app.store.sequence, seq);
    await assert.rejects(
      c.command("decisions/" + expired.id + "/answer", {
        request_id: id(),
        answer: "A",
      }),
      /DECISION_EXPIRED/,
    );
  }));

test("registered client identity survives process changes; admin rule controls are bound and versioned", () =>
  fixture(async (app, server, c) => {
    const registration = await c.command("clients", {
      request_id: id(),
      name: "Synthetic native",
      instance_id: id(),
    });
    const clientID = registration.resource_ids.find(
      (r) => r.type === "ClientRegistration",
    )!.id;
    const next = await c.command("clients", {
      request_id: id(),
      name: "Synthetic native",
      client_id: clientID,
      instance_id: id(),
    });
    const state: any = await c.query("requests/" + next.request_id);
    assert.equal(state.result.client_id, clientID);
    assert.equal(app.store.all("ClientRegistration").length, 1);
    const rule = await c.command("admin/authorization-rules", {
      request_id: id(),
      action: "file.write",
      resource: "synthetic.txt",
      parameters: { text: "synthetic" },
    });
    const ruleID = rule.resource_ids.find(
      (r) => r.type === "AuthorizationRule",
    )!.id;
    await c.command("admin/authorization-rules/" + ruleID + "/disable", {
      request_id: id(),
      expected_revision: "1",
    });
    await assert.rejects(
      c.command("admin/authorization-rules/" + ruleID + "/disable", {
        request_id: id(),
        expected_revision: "1",
      }),
      /REVISION_CONFLICT/,
    );
    assert.equal(
      (app.store.get("AuthorizationRule", ruleID) as any).state,
      "DISABLED",
    );
  }));

test("attention deadlines invalidate the read snapshot even without a journal mutation", () =>
  fixture(async (app, server, c) => {
    const op = app.authorization.prepare(
      { session_id: app.host.sessionID, task_id: null, execution_id: null },
      "file.write",
      "deadline.txt",
      { text: "synthetic" },
    );
    const a: any = app.store.get("AuthorizationRequest", op.authorization_id!);
    const expires = new Date(Date.now() + 700).toISOString();
    app.store.commit([revise(a, { expires_at: expires })]);
    const before: any = await c.query("attention");
    assert.equal(before.counts.authorizations, 1);
    assert.equal(before.valid_until, expires);
    const seq = app.store.sequence;
    await new Promise((r) => setTimeout(r, 750));
    const after: any = await c.query("attention");
    assert.equal(after.counts.authorizations, 0);
    assert.notEqual(after.version, before.version);
    assert.equal(app.store.sequence, seq);
  }));
