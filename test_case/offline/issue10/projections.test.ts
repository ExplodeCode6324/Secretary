import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { ApplicationService } from "../../../src/pi_secretary/src/application-service.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import { revise, id } from "../../../src/pi_secretary/src/store.ts";
import { OperationDisplay } from "../../../src/pi_secretary/src/operation-display.ts";
import { artifactPath } from "../../../src/pi_secretary/src/artifact-path.ts";
import {
  Cursors,
  validate as validateContract,
} from "../../../src/pi_secretary/src/api/protocol.ts";
import type {
  Artifact,
  Operation,
} from "../../../src/pi_secretary/src/contracts.ts";
import { interrupted } from "../issue18/helpers.ts";
const validate = (name: string, value: unknown): void => {
  validateContract(name, value);
};
async function fixture(
  run: (app: App, api: ApplicationService) => Promise<void>,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue10-projections-"));
  const app = await App.open(dir, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  try {
    await run(app, new ApplicationService(app));
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
function setup(
  app: App,
  parameters: unknown,
  receipt: unknown,
  action = "shell.run",
) {
  const { op, e } = interrupted(app, action);
  const ref = app.store.put(parameters);
  const updated = revise(op, {
    action: { ...op.action, parameters_ref: ref, parameters_hash: ref.sha256 },
    receipt: app.store.put(receipt),
  });
  app.store.commit([updated]);
  return { op: updated, e };
}
async function collect(
  api: ApplicationService,
  op: Operation,
  part: string,
  first?: any,
) {
  let page =
    first ??
    ((await api.query(
      api.principal,
      `operations/${op.id}/content`,
      new URLSearchParams({ part }),
    )) as any);
  const chunks: string[] = [];
  const version = page.content_version;
  do {
    validate("OperationText", page);
    assert.equal(page.state, "available");
    assert.equal(page.content_version, version);
    assert(Buffer.byteLength(page.text) <= 32768);
    assert(!page.text.includes("\ufffd"));
    chunks.push(page.text);
    if (!page.next_cursor) {
      assert.equal(Buffer.byteLength(chunks.join("")), Number(page.bytes));
      break;
    }
    page = await api.query(
      api.principal,
      `operations/${op.id}/content`,
      new URLSearchParams({ part, cursor: page.next_cursor }),
    );
  } while (chunks.length < 100);
  assert(chunks.length < 100);
  return chunks.join("");
}
test("bounded operation detail preserves Unicode, parameters, outputs and pure reads", () =>
  fixture(async (app, api) => {
    const text = '中😀𠮷é\n\u0000"\\'.repeat(6500);
    const { op } = setup(
      app,
      {
        command: text,
        cwd: "/synthetic/project",
        timeout: 1000,
        execution: { env: { PRIVATE_TOKEN: "hidden-env" } },
      },
      { stdout: text, stderr: "", exit_code: 0, truncated: true },
    );
    const sequence = app.store.sequence;
    const detail: any = await api.query(api.principal, `operations/${op.id}`);
    validate("Operation", detail);
    assert(
      Buffer.byteLength(JSON.stringify({ api_version: "1", data: detail })) <=
        262144,
    );
    assert.equal(detail.display.source_truncated, true);
    assert.equal(detail.display.stderr.state, "available");
    assert.equal(detail.display.stderr.text, "");
    assert.equal(await collect(api, op, "stdout", detail.display.stdout), text);
    const parameters = JSON.parse(
      await collect(api, op, "parameters", detail.display.parameters),
    );
    assert.deepEqual(parameters, {
      command: text,
      cwd: "/synthetic/project",
      timeout: 1000,
    });
    assert(!JSON.stringify(detail).includes("objects/"));
    assert(!JSON.stringify(detail).includes("hidden-env"));
    const list: any = await api.query(api.principal, "operations");
    assert.equal(list.items[0].display, undefined);
    assert.equal(app.store.sequence, sequence);
  }));
test("operation content cursors bind part, operation, data version and instance", () =>
  fixture(async (app, api) => {
    const { op } = setup(
      app,
      { command: "x".repeat(60000) },
      { stdout: "s".repeat(60000) },
    );
    const page: any = await api.query(
      api.principal,
      `operations/${op.id}/content`,
      new URLSearchParams({ part: "stdout" }),
    );
    const other = setup(app, {}, {}).op;
    for (const [target, part] of [
      [other.id, "stdout"],
      [op.id, "parameters"],
    ])
      await assert.rejects(
        api.query(
          api.principal,
          `operations/${target}/content`,
          new URLSearchParams({ part, cursor: page.next_cursor }),
        ),
        /CURSOR_EXPIRED/,
      );
    const sharedCursors = new Cursors("synthetic-secret");
    const firstDomain = new OperationDisplay(
      app.store,
      sharedCursors,
      "first-domain",
    );
    const secondDomain = new OperationDisplay(
      app.store,
      sharedCursors,
      "second-domain",
    );
    const domainPage = await firstDomain.text(op, "stdout");
    await assert.rejects(
      secondDomain.text(op, "stdout", domainPage.next_cursor),
      /CURSOR_EXPIRED/,
    );
    const restarted = new ApplicationService(app);
    await assert.rejects(
      restarted.query(
        restarted.principal,
        `operations/${op.id}/content`,
        new URLSearchParams({ part: "stdout", cursor: page.next_cursor }),
      ),
      /CURSOR_EXPIRED/,
    );
    app.store.commit([
      revise(op, { receipt: app.store.put({ stdout: "changed" }) }),
    ]);
    await assert.rejects(
      api.query(
        api.principal,
        `operations/${op.id}/content`,
        new URLSearchParams({ part: "stdout", cursor: page.next_cursor }),
      ),
      /CURSOR_EXPIRED/,
    );
  }));
test("manual resolution retains original output and provides full long reason and resolution note", () =>
  fixture(async (app, api) => {
    const error = "失败😀".repeat(20000),
      note = "裁定😀".repeat(12000);
    const { op } = setup(
      app,
      { command: "false" },
      {
        stdout: "observed",
        stderr: "failed",
        error,
        exit_code: 1,
        truncated: false,
      },
    );
    api.command(api.principal, `operations/${op.id}/resolve`, {
      request_id: id(),
      expected_revision: String(op.revision),
      outcome: "UNVERIFIED",
      note,
    });
    const detail: any = await api.query(api.principal, `operations/${op.id}`);
    assert.equal(detail.resolution.note_truncated, true);
    assert(note.startsWith(detail.resolution.note));
    assert.equal(await collect(api, op, "stdout"), "observed");
    const reason = JSON.parse(
      await collect(api, op, "reason", detail.display.reason),
    );
    assert.equal(reason.receipt_error, error);
    assert.equal(reason.resolution_note, note);
    assert.equal(reason.effect, "UNKNOWN");
  }));
test("missing, invalid, corrupt, symlinked sources remain explicit unavailable", () =>
  fixture(async (app, api) => {
    const { op } = setup(app, { command: "ls" }, {});
    const display = new OperationDisplay(
      app.store,
      new Cursors("synthetic-secret"),
      "test-domain",
    );
    assert.equal(
      (await display.text(op, "stdout")).unavailable_reason,
      "NOT_RECORDED",
    );
    const malformed = {
      ...op,
      receipt: app.store.put("not json", "text/plain"),
    };
    assert.equal(
      (await display.text(malformed, "stdout")).state,
      "unavailable",
    );
    const duplicate = {
      ...op,
      receipt: app.store.put('{"stdout":"a","stdout":"b"}', "application/json"),
    };
    assert.equal(
      (await display.text(duplicate, "stdout")).unavailable_reason,
      "INVALID_SOURCE",
    );
    const file = path.join(app.store.dir, op.action.parameters_ref.path);
    fs.writeFileSync(file, "x".repeat(op.action.parameters_ref.bytes));
    assert.equal((await display.text(op, "parameters")).state, "unavailable");
    fs.unlinkSync(file);
    assert.equal(
      (await display.text(op, "parameters")).unavailable_reason,
      "SOURCE_MISSING",
    );
    fs.symlinkSync("/etc/hosts", file);
    assert.equal(
      (await display.text(op, "parameters")).unavailable_reason,
      "CORRUPT_SOURCE",
    );
    await assert.rejects(
      api.query(
        api.principal,
        `operations/${op.id}/content`,
        new URLSearchParams({ part: "stdout", limit: "1" }),
      ),
      /INVALID_QUERY/,
    );
  }));
test("world business JSON keys survive while evidence locator paths are omitted", () =>
  fixture(async (app, api) => {
    const evidence = app.store.put("Synthetic evidence", "text/plain");
    const value = {
      path: "business path",
      revision: 9,
      entrypoint: "business entry",
      nested: { value: [1, true, null, "中😀"] },
    };
    const { op } = setup(
      app,
      {
        value,
        provenance: {
          path: { path: "internal", nested: 1 },
          evidence: [{ content: evidence, comment: "keep" }],
        },
      },
      {},
      "world.change",
    );
    const result = JSON.parse(await collect(api, op, "parameters"));
    assert.deepEqual(result.value, value);
    assert.equal(result.provenance.path, undefined);
    assert.equal(result.provenance.evidence[0].content.path, undefined);
    assert.equal(result.provenance.evidence[0].comment, "keep");
  }));
test("task scope filtering occurs before stable pagination and binds cursors", () =>
  fixture(async (app, api) => {
    const scope = id(),
      other = id();
    for (const scope_id of [null, scope, other, scope, null]) {
      const task = app.scheduler.propose(
        "Synthetic scope query",
        id(),
        app.host.sessionID,
      );
      app.store.commit([revise(task, { scope_id })]);
    }
    const query = (q: Record<string, string>) =>
      api.query(api.principal, "tasks", new URLSearchParams(q)) as Promise<any>;
    const first = await query({ scope_id: scope, limit: "1" });
    assert.equal(first.items.length, 1);
    assert.equal(first.items[0].scope_id, scope);
    const next = await query({
      scope_id: scope,
      limit: "1",
      cursor: first.next_cursor,
    });
    assert.equal(next.items.length, 1);
    assert.equal(next.items[0].scope_id, scope);
    assert.notEqual(first.items[0].id, next.items[0].id);
    assert.equal(next.next_cursor, null);
    assert.equal((await query({ scope_id: "none" })).items.length, 2);
    assert.equal((await query({})).items.length, 5);
    await assert.rejects(
      query({ scope_id: other, cursor: first.next_cursor }),
      /CURSOR_EXPIRED/,
    );
    await assert.rejects(query({ scope_id: "bad" }), /INVALID_QUERY/);
  }));
test("artifact locators classify relative bases and reject absolute, traversal and historical unknown paths", () =>
  fixture(async (app) => {
    const { e } = interrupted(app);
    const artifact = { workspace_path: "reports/result.txt" } as Artifact;
    assert.equal(
      artifactPath(artifact, e).path_unavailable_reason,
      "MISSING_BASE",
    );
    const bound = {
      ...e,
      workspace_binding: {
        kind: "NONE" as const,
        root_path: "/synthetic/task",
        notes_path: null,
      },
    } as typeof e;
    assert.equal(artifactPath(artifact, bound).path_base, "task");
    const scopeID = id();
    const scoped = {
      ...bound,
      scope_id: scopeID,
      workspace_binding: {
        ...bound.workspace_binding!,
        kind: "DIRECTORY" as const,
      },
    };
    assert.deepEqual(artifactPath(artifact, scoped), {
      relative_path: "reports/result.txt",
      path_base: "scope",
      scope_id: scopeID,
      path_unavailable_reason: null,
    });
    assert.equal(
      artifactPath({ ...artifact, workspace_path: "x".repeat(4097) }, bound)
        .path_unavailable_reason,
      "PATH_TOO_LONG",
    );
    for (const workspace_path of [
      "/etc/passwd",
      "../secret",
      "sub/../secret",
      "C:\\secret",
      "x\0y",
      "..\\secret",
    ]) {
      const actual = artifactPath({ ...artifact, workspace_path }, bound);
      assert.equal(actual.relative_path, null);
      assert.equal(actual.path_unavailable_reason, "INVALID_PATH");
    }
  }));

test("file and program parameters retain actual business values and exclude executor metadata", () =>
  fixture(async (app, api) => {
    const samples = [
      {
        action: "file.write",
        parameters: { path: "src/main.txt", content: "中文😀\nactual content" },
      },
      {
        action: "program.run",
        parameters: {
          program_id: id(),
          revision: 3,
          code_digest: "a".repeat(64),
          capability: "synthetic",
          parameters: {
            path: "business",
            entrypoint: "business",
            workspace: "business",
            revision: 7,
          },
        },
      },
    ];
    for (const sample of samples) {
      const { op } = setup(
        app,
        {
          ...sample.parameters,
          entrypoint: "internal-entry",
          workspace: "/private/internal",
        },
        {},
        sample.action,
      );
      assert.deepEqual(
        JSON.parse(await collect(api, op, "parameters")),
        sample.parameters,
      );
    }
  }));
test("large source is streamed without Store whole-object readers", () =>
  fixture(async (app) => {
    const { createHash } = await import("node:crypto");
    const { op } = setup(app, {}, {});
    const temp = path.join(app.store.dir, "large-source.tmp");
    const fd = fs.openSync(temp, "wx");
    const hash = createHash("sha256");
    let bytes = 0;
    const write = (value: string) => {
      const chunk = Buffer.from(value);
      fs.writeSync(fd, chunk);
      hash.update(chunk);
      bytes += chunk.length;
    };
    try {
      write('{"stdout":"');
      for (let i = 0; i < 1024; i++) write("😀".repeat(2048));
      write('","truncated":false}');
    } finally {
      fs.closeSync(fd);
    }
    const digest = hash.digest("hex");
    const locator = "objects/" + digest;
    fs.renameSync(temp, path.join(app.store.dir, locator));
    const large = {
      ...op,
      receipt: {
        path: locator,
        sha256: digest,
        bytes,
        media_type: "application/json",
      },
    };
    const display = new OperationDisplay(
      app.store,
      new Cursors("synthetic-secret"),
      "test-domain",
    );
    const read = app.store.read,
      readBytes = app.store.bytes;
    app.store.read = () => {
      throw Error("whole object read forbidden");
    };
    app.store.bytes = () => {
      throw Error("whole object read forbidden");
    };
    try {
      const page = await display.text(large, "stdout");
      assert.equal(page.state, "available");
      assert.equal(page.bytes, String(8 * 1024 * 1024));
      assert.equal(page.text, "😀".repeat(8192));
      assert(page.next_cursor);
      assert.equal(
        page.content_version,
        createHash("sha256")
          .update("😀".repeat(2048 * 1024))
          .digest("hex"),
      );
    } finally {
      app.store.read = read;
      app.store.bytes = readBytes;
    }
  }));
test("HTTP content route enforces authentication and resource scope", () =>
  fixture(async (app) => {
    const { serveCore } =
      await import("../../../src/pi_secretary/src/api-v1.ts");
    const { op } = setup(
      app,
      { command: "echo synthetic" },
      { stdout: "synthetic" },
    );
    const other = setup(app, {}, {}).op;
    app.store.commit([
      revise(other, {
        scope: { session_id: id(), task_id: null, execution_id: null },
      }),
    ]);
    const server = await serveCore(app, 0, undefined, { pump: false });
    try {
      const url =
        server.endpoint.url + `/api/v1/operations/${op.id}/content?part=stdout`;
      assert.equal((await fetch(url)).status, 401);
      const headers = { Authorization: `Bearer ${server.endpoint.token}` };
      const result = await fetch(url, { headers });
      assert.equal(result.status, 200);
      const body = await result.json();
      validate("OperationText", body.data);
      assert.equal(body.data.text, "synthetic");
      assert.equal(
        (
          await fetch(
            server.endpoint.url +
              `/api/v1/operations/${other.id}/content?part=stdout`,
            { headers },
          )
        ).status,
        404,
      );
    } finally {
      await server.close();
    }
  }));

test("escaped control text respects the complete response budget and malformed source limits", () =>
  fixture(async (app, api) => {
    const text = "\u0001".repeat(70000);
    const { op } = setup(
      app,
      { command: text },
      { stdout: text, stderr: text, error: text },
    );
    const detail: any = await api.query(api.principal, `operations/${op.id}`);
    assert(
      Buffer.byteLength(JSON.stringify({ api_version: "1", data: detail })) <=
        262144,
    );
    assert(Buffer.byteLength(detail.display.stdout.text) < 32768);
    assert.equal(await collect(api, op, "stdout", detail.display.stdout), text);
    const display = new OperationDisplay(
      app.store,
      new Cursors("synthetic"),
      "domain",
    );
    const deep = {
      ...op,
      receipt: app.store.put(
        '{"stdout":' + "[".repeat(65) + "0" + "]".repeat(65) + "}",
      ),
    };
    assert.equal(
      (await display.text(deep, "stdout")).unavailable_reason,
      "SOURCE_TOO_DEEP",
    );
    const tooLong = app.store.put({ parameters: { ["x".repeat(8193)]: true } });
    const largeKey = {
      ...op,
      action: {
        ...op.action,
        action: "program.run",
        parameters_ref: tooLong,
        parameters_hash: tooLong.sha256,
      },
    };
    assert.equal(
      (await display.text(largeKey, "parameters")).unavailable_reason,
      "SOURCE_KEY_TOO_LONG",
    );
  }));

test("4 MiB continuation reads reuse verified text without rereading the 8 MiB receipt", async (t) =>
  fixture(async (app, api) => {
    const { createHash } = await import("node:crypto");
    const output = "😀".repeat(1024 * 1024);
    const { op } = setup(app, {}, { stdout: output, stderr: output });
    const open = fs.promises.open;
    let opens = 0;
    t.mock.method(
      fs.promises,
      "open",
      async (...args: Parameters<typeof open>) => {
        opens++;
        return open(...args);
      },
    );
    let cursor: string | null = null,
      pages = 0,
      bytes = 0;
    const hash = createHash("sha256");
    do {
      const q = new URLSearchParams({ part: "stdout" });
      if (cursor) q.set("cursor", cursor);
      const page: any = await api.query(
        api.principal,
        `operations/${op.id}/content`,
        q,
      );
      assert.equal(page.state, "available");
      hash.update(page.text);
      bytes += Buffer.byteLength(page.text);
      pages++;
      cursor = page.next_cursor;
    } while (cursor);
    assert.equal(pages, 128);
    assert.equal(bytes, 4 * 1024 * 1024);
    assert.equal(
      hash.digest("hex"),
      createHash("sha256").update(output).digest("hex"),
    );
    assert.equal(
      opens,
      2,
      "one metadata pass and one extraction pass, independent of page count",
    );
  }));

test("warm text cache rejects source mutation, removal and symlink replacement", () =>
  fixture(async (app, api) => {
    const { op } = setup(app, {}, { stdout: "verified output", stderr: "" });
    const query = () =>
      api.query(
        api.principal,
        `operations/${op.id}/content`,
        new URLSearchParams({ part: "stdout" }),
      ) as Promise<any>;
    const file = path.join(app.store.dir, op.receipt!.path);
    const original = fs.readFileSync(file);
    assert.equal((await query()).text, "verified output");
    fs.writeFileSync(file, original.toString().replace("verified", "tampered"));
    assert.equal((await query()).unavailable_reason, "CORRUPT_SOURCE");
    fs.writeFileSync(file, original);
    assert.equal((await query()).text, "verified output");
    fs.unlinkSync(file);
    assert.equal((await query()).unavailable_reason, "SOURCE_MISSING");
    fs.writeFileSync(file, original);
    assert.equal((await query()).text, "verified output");
    fs.unlinkSync(file);
    fs.symlinkSync("/etc/hosts", file);
    assert.equal((await query()).unavailable_reason, "CORRUPT_SOURCE");
  }));

test("cache eviction obeys byte and entry ceilings and falls back to verified reads", () =>
  fixture(async (app) => {
    const { OperationTextCache, sourceStamp } =
      await import("../../../src/pi_secretary/src/operation-text-cache.ts");
    const cache = new OperationTextCache(app.store, 8, 2);
    const ref = app.store.put({ stdout: "source" });
    const value = (text: string) => ({
      content: Buffer.from(text),
      version: "synthetic",
      sources: [sourceStamp(app.store, ref)],
    });
    cache.put("a", value("1234"));
    cache.put("b", value("5678"));
    assert(cache.get("a"));
    cache.put("c", value("9012"));
    assert.equal(cache.get("b"), undefined);
    assert(cache.get("a"));
    cache.put("oversize", value("123456789"));
    assert.equal(cache.get("oversize"), undefined);
    cache.put("empty", value(""));
    assert.equal(cache.get("c"), undefined);
    assert(cache.get("empty"));
  }));

test("detail response shrinking reuses projected prefixes and shares receipt ancestry", async (t) =>
  fixture(async (app, api) => {
    const text = "\u0001".repeat(70000);
    const { op } = setup(
      app,
      { command: text },
      { stdout: text, stderr: text, error: text },
    );
    const open = fs.promises.open;
    let opens = 0;
    t.mock.method(
      fs.promises,
      "open",
      async (...args: Parameters<typeof open>) => {
        opens++;
        return open(...args);
      },
    );
    const result: any = await api.query(api.principal, `operations/${op.id}`);
    assert(
      Buffer.byteLength(JSON.stringify({ api_version: "1", data: result })) <=
        262144,
    );
    assert(result.display.stdout.text.length < 32768);
    assert.equal(
      opens,
      7,
      "resolution, one shared ancestry, parameters, stdout, stderr, error and note only",
    );
    assert.equal(await collect(api, op, "stdout", result.display.stdout), text);
  }));
