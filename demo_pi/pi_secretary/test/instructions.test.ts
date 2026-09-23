import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentText } from "@earendil-works/pi-ai";
import { App } from "../src/app.ts";
import { serve } from "../src/backend.ts";
import { api } from "../src/ui-client.ts";
import { hash } from "../src/store.ts";
import {
  getInstructions,
  saveInstructions,
  BASE_SYSTEM,
  DEFAULT_INSTRUCTIONS,
} from "../src/instructions.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../src/model.ts";
import type { Context, MainPromptSnapshot, Input } from "../src/contracts.ts";
const cfg = (stream: StreamFn = fixtureStream) => ({
  model: fixtureModel,
  stream,
});
const temp = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "secretary-instructions-"));
const systemText = (messages: any[]) =>
  contentText(messages.find((m) => m.role === "system").content);
const latest = (app: App) =>
  app.store.get<Context>("Context", app.host.session.last_context_id!);

test("new turns replace historical system; empty instructions disable injection; contexts retain evidence", async () => {
  const dir = temp();
  const app = await App.open(dir, cfg());
  try {
    assert.equal(getInstructions(app.store).content, DEFAULT_INSTRUCTIONS);
    app.host.accept("hello");
    await app.host.drain();
    const first = latest(app);
    const oldBytes = app.store.bytes(first.raw_context);
    const oldRaw = app.store.read<any[]>(first.raw_context);
    assert.equal(oldRaw.filter((m) => m.role === "system").length, 1);
    assert(systemText(oldRaw).includes("简体中文"));
    assert(oldRaw[0].toolsAdded.length > 0);
    saveInstructions(app.store, "NEW_CONFIG_ENGLISH", 1);
    app.host.accept("second");
    await app.host.drain();
    const second = latest(app);
    const raw = app.store.read<any[]>(second.raw_context);
    assert.equal(second.instructions_revision, 2);
    assert(systemText(raw).includes("NEW_CONFIG_ENGLISH"));
    assert(!systemText(raw).includes(DEFAULT_INSTRUCTIONS));
    assert.equal(raw.filter((m) => m.role === "system").length, 1);
    assert.deepEqual(raw[0].toolsAdded, oldRaw[0].toolsAdded);
    assert.equal(second.system_prompt_hash, hash(systemText(raw)));
    assert.equal(second.base_prompt_version, hash(BASE_SYSTEM));
    assert(app.store.bytes(first.raw_context).equals(oldBytes));
    assert(raw.some((m) => m.role === "user" && m.content === "hello"));
    saveInstructions(app.store, "", 2);
    app.host.accept("third");
    await app.host.drain();
    assert.equal(
      systemText(app.store.read<any[]>(latest(app).raw_context)),
      BASE_SYSTEM,
    );
    assert.equal(
      app.store.all<MainPromptSnapshot>("MainPromptSnapshot").length,
      3,
    );
    for (const c of app.store
      .all<Context>("Context")
      .filter((c) => c.purpose === "MAIN")) {
      assert(c.instructions_revision);
      assert(c.system_prompt_hash);
    }
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("settings saved during tool loop never change current turn and never deadlock", async () => {
  const dir = temp();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r));
  const captured: string[] = [];
  const stream: StreamFn = async (m, c, o) => {
    captured.push(systemText(c.messages));
    if (captured.length === 1) {
      entered();
      await gate;
      return replyStream(
        [
          {
            type: "toolCall",
            id: "query",
            name: "memory_read",
            arguments: { source: "log" },
          },
        ],
        m,
      );
    }
    return fixtureStream(m, c, o);
  };
  const app = await App.open(dir, cfg(stream));
  try {
    app.host.accept("first");
    const running = app.host.drain();
    await started;
    saveInstructions(app.store, "NEXT_ONLY", 1);
    release();
    await running;
    assert(captured.length >= 2);
    assert(captured.every((s) => !s.includes("NEXT_ONLY")));
    app.host.accept("next");
    await app.host.drain();
    assert(captured.at(-1)!.includes("NEXT_ONLY"));
  } finally {
    release();
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("interrupted turn resumes its persisted prompt after settings update and reopen", async () => {
  const dir = temp();
  let app = await App.open(
    dir,
    cfg(() => {
      throw Error("test interruption");
    }),
  );
  try {
    app.host.accept("recover me");
    await app.host.drain();
    const original = latest(app);
    const loop = original.loop_id;
    assert(app.store.all<Input>("Input").some((i) => i.state === "CLAIMED"));
    saveInstructions(app.store, "NEW_AFTER_RESTART", 1);
    await app.close();
    app = await App.open(dir, cfg());
    await app.host.drain();
    assert.equal(latest(app).loop_id, loop);
    assert.equal(latest(app).instructions_revision, 1);
    assert(
      !systemText(app.store.read<any[]>(latest(app).raw_context)).includes(
        "NEW_AFTER_RESTART",
      ),
    );
    app.host.accept("fresh turn");
    await app.host.drain();
    assert.equal(latest(app).instructions_revision, 2);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("compaction cannot own or override the custom instructions; tasks remain isolated", async () => {
  const dir = temp();
  const app = await App.open(dir, cfg());
  try {
    saveInstructions(app.store, "UNIQUE_MASTER_STYLE", 1);
    app.host.accept("hello");
    await app.host.drain();
    await app.host.compact();
    app.host.accept("task: run fixture");
    await app.settle();
    const main = app.store
      .all<Context>("Context")
      .filter((c) => c.purpose === "MAIN");
    assert(
      main.every((c) =>
        systemText(app.store.read<any[]>(c.raw_context)).includes(
          "UNIQUE_MASTER_STYLE",
        ),
      ),
    );
    const others = app.store
      .all<Context>("Context")
      .filter((c) => c.purpose !== "MAIN");
    assert(others.some((c) => c.purpose === "COMPACTION"));
    assert(others.some((c) => c.purpose === "TASK"));
    for (const c of others) {
      assert(
        !systemText(app.store.read<any[]>(c.raw_context)).includes(
          "UNIQUE_MASTER_STYLE",
        ),
      );
      assert.equal(c.instructions_revision, undefined);
    }
    assert.equal(getInstructions(app.store).revision, 2);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("authenticated settings API serializes concurrent writes, rejects invalid data and preserves escaped text", async () => {
  const dir = temp();
  const app = await App.open(dir, cfg());
  const server = await serve(app);
  try {
    assert.equal(
      (await fetch(server.endpoint.url + "/api/instructions")).status,
      401,
    );
    const client = (await api(server.endpoint, "/api/client", {})).client;
    const route = "/api/instructions?client=" + client;
    const initial = await api(server.endpoint, route);
    assert.equal(initial.settings.revision, 1);
    const saves = await Promise.allSettled(
      ["first", "second"].map((content) =>
        api(server.endpoint, "/api/instructions", {
          client,
          content,
          expected_revision: 1,
        }),
      ),
    );
    assert.equal(saves.filter((r) => r.status === "fulfilled").length, 1);
    assert(
      saves.some(
        (r) =>
          r.status === "rejected" &&
          String(r.reason).includes("INSTRUCTIONS_CONFLICT"),
      ),
    );
    for (const content of ["x".repeat(2001), null, {}, "bad\u0000text"])
      await assert.rejects(
        api(server.endpoint, "/api/instructions", {
          client,
          content,
          expected_revision: 2,
        }),
        /INVALID_INSTRUCTIONS/,
      );
    const text = '<script>alert("not code")</script>\n😀';
    await api(server.endpoint, "/api/instructions", {
      client,
      content: text,
      expected_revision: 2,
    });
    assert.equal((await api(server.endpoint, route)).settings.content, text);
    assert.equal(getInstructions(app.store).revision, 3);
    assert.equal(app.world, undefined);
    const page = await (await fetch(server.endpoint.url)).text();
    assert(page.includes('id="instructions-content"'));
    assert(!app.store.all("Input").length);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("corrupt configuration prevents startup rather than becoming empty defaults", async () => {
  const dir = temp();
  const app = await App.open(dir, cfg());
  const event = app.store.logs.find(
    (e) => e.event_type === "instructions.initialized",
  )!;
  const file = path.join(dir, event.payload.path);
  await app.close();
  fs.writeFileSync(file, "corrupt");
  try {
    await assert.rejects(
      App.open(dir, cfg()),
      /CORRUPT|HASH|OBJECT|Unexpected/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("SIGKILL after settings commit preserves active snapshot and next-turn setting", async () => {
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const dir = temp();
  let app: App | undefined;
  try {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(
          new URL("./helpers/instructions-crash.ts", import.meta.url),
        ),
        dir,
      ],
      { stdio: "ignore" },
    );
    const signal = await new Promise<string | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (_code, signal) => resolve(signal));
    });
    assert.equal(signal, "SIGKILL");
    app = await App.open(dir, cfg());
    assert.equal(getInstructions(app.store).content, "POST_CRASH_NEW_CONFIG");
    await app.host.drain();
    assert.equal(latest(app).instructions_revision, 1);
    app.host.accept("New turn after recovery");
    await app.host.drain();
    assert.equal(latest(app).instructions_revision, 2);
  } finally {
    await app?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy claimed context retains original prompt during recovery, updates on next turn", async () => {
  const { saveContext } = await import("../src/context.ts");
  const { id, revise } = await import("../src/store.ts");
  const dir = temp();
  const app = await App.open(dir, cfg());
  try {
    const input = app.host.accept("legacy interrupted input");
    const loop = id();
    const c = saveContext(
      app.store,
      [
        { role: "system", content: "LEGACY_SYSTEM", timestamp: Date.now() },
        {
          role: "user",
          content: "legacy interrupted input",
          timestamp: Date.now(),
        },
      ],
      { session_id: app.host.sessionID, task_id: null, execution_id: null },
      "MAIN",
      fixtureModel.id,
      loop,
    );
    app.store.commit([
      revise(input, { state: "CLAIMED", loop_id: loop }),
      revise(app.host.session, {
        state: "RUNNING",
        active_loop_id: loop,
        claimed_input_ids: [input.id],
        last_context_id: c.id,
      }),
    ]);
    await app.host.drain();
    assert.equal(latest(app).instructions_revision, 0);
    assert.equal(
      systemText(app.store.read<any[]>(latest(app).raw_context)),
      "LEGACY_SYSTEM",
    );
    app.host.accept("next turn");
    await app.host.drain();
    assert.equal(latest(app).instructions_revision, 1);
    assert(
      systemText(app.store.read<any[]>(latest(app).raw_context)).includes(
        DEFAULT_INSTRUCTIONS,
      ),
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
