import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  LocalFiles,
  freshState,
  exportLegacyState,
  type LocalState,
} from "../../../src/pi_secretary/src/tui/state.ts";
import {
  Delivery,
  type DeliveryClient,
} from "../../../src/pi_secretary/src/tui/delivery.ts";
import { TerminalApp } from "../../../src/pi_secretary/src/tui/app.ts";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import {
  plainSnapshot,
  originAt,
  equalSnapshotContent,
} from "../../../src/pi_secretary/src/tui/draft.ts";
import { until } from "../issue9/helpers.ts";

test("v1 migration backs up original bytes, marks all text unknown, and exports current v1 content", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "secretary-issue91-state-"),
  );
  const files = new LocalFiles(directory);
  const v1 = {
    ...freshState("domain", "fixture"),
    version: 1,
    drafts: {
      Main: { raw: " /T", generation: 3 },
      Task: { raw: "Task old", generation: 1 },
    },
    pending: {
      id: "same-id",
      body: { request_id: "same-id", text: "x" },
      raw: "/send x",
      created_at: new Date().toISOString(),
      attempts: ["old"],
      status: "UNKNOWN",
    },
  };
  const original = JSON.stringify(v1);
  await fs.writeFile(path.join(directory, "state.json"), original, {
    mode: 0o600,
  });
  try {
    const state = await files.open("domain", "fixture");
    assert.equal(state.version, 2);
    const backup = (await fs.readdir(directory)).find((name) =>
      name.startsWith("v1-before-upgrade-"),
    )!;
    assert.equal(
      await fs.readFile(path.join(directory, backup), "utf8"),
      original,
    );
    assert.equal(originAt(state.drafts.Main.snapshot!, 1), "unknown");
    assert.equal(originAt(state.pending!.snapshot!, 2), "unknown");
    assert.deepEqual(state.pending!.body, v1.pending.body);
    state.drafts.Task = {
      raw: "latest",
      snapshot: plainSnapshot("latest", "typed"),
      generation: 2,
    };
    await files.save(state);
    const legacy = exportLegacyState(state);
    assert.equal(legacy.version, 1);
    assert.equal(legacy.drafts.Task.raw, "latest");
    assert.equal(legacy.drafts.Main.snapshot, undefined);
    assert.deepEqual(legacy.pending!.body, v1.pending.body);
  } finally {
    await files.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("bound migrated pending retries immutable body without slash classification; editing removes binding", async () => {
  const state = freshState("domain", "fixture"),
    raw = "/send x",
    snapshot = plainSnapshot(raw);
  state.pending = {
    id: "original",
    raw,
    snapshot,
    body: { request_id: "original", text: "x" },
    created_at: new Date().toISOString(),
    attempts: ["instance"],
    status: "UNKNOWN",
  };
  state.drafts.Main = { raw, snapshot, generation: 1, binding: "original" };
  const posts: unknown[] = [],
    saves: LocalState[] = [];
  const delivery = new Delivery(state, {
    save: async (value) => {
      saves.push(structuredClone(value));
    },
    recover: async () => "unused",
  });
  delivery.client = {
    endpoint: { instance_id: "instance" },
    query: async () => {
      throw Error("TRANSPORT_TIMEOUT");
    },
    command: async (_: string, body: unknown) => {
      posts.push(body);
      return { request_id: "original", acceptance: "ACCEPTED" };
    },
    syncCursor: async () => ({ cursor: "c" }),
  } as unknown as DeliveryClient;
  const app = new TerminalApp("unused", new VirtualTerminal());
  app.delivery = delivery;
  delivery.onChange = () => app.draw();
  app.editors.Main.enabled = true;
  app.draw();
  app.editors.Main.handleInput("\x1b[13;2u");
  await until(() => !delivery.busy && posts.length === 1);
  assert.deepEqual(posts, [{ request_id: "original", text: "x" }]);
  assert.equal(state.pending, undefined);
  assert(saves.some((s) => s.pending?.status === "ACCEPTED"));
  state.drafts.Main = { raw, snapshot, generation: 4, binding: "original" };
  app.draw();
  app.editors.Main.handleInput("!");
  assert.equal(state.drafts.Main.binding, undefined);
  await delivery.close();
});

test("v2 recovery preserves independent paste payloads, cursor and immutable pending body", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "secretary-issue91-recover-"),
  );
  const files = new LocalFiles(directory);
  const app = new TerminalApp("unused", new VirtualTerminal());
  const editor = app.editors.Main;
  editor.handleInput("A ");
  editor.handleInput("\x1b[200~one\n二\x1b[201~");
  editor.handleInput(" B ");
  editor.handleInput("\x1b[200~three\nfour\x1b[201~");
  editor.handleInput("\x1b[D");
  const snapshot = editor.snapshot(),
    raw = editor.getExpandedText();
  try {
    const state = await files.open("domain", "fixture");
    state.drafts.Main = { raw, snapshot, generation: 7 };
    state.pending = {
      id: "r",
      raw,
      snapshot,
      body: { request_id: "r", text: raw },
      created_at: new Date().toISOString(),
      attempts: [],
      status: "UNKNOWN",
    };
    const recovery = await files.recover(state.pending);
    state.recovery = { file: recovery, id: "r" };
    await files.save(state);
    await files.close();
    const reopened = await files.open("domain", "fixture");
    assert(equalSnapshotContent(reopened.drafts.Main.snapshot, snapshot));
    assert.deepEqual(reopened.drafts.Main.snapshot!.cursor, snapshot.cursor);
    const record = JSON.parse(
      await fs.readFile(path.join(directory, recovery), "utf8"),
    );
    assert.deepEqual(record.body, state.pending.body);
    assert.deepEqual(record.snapshot, snapshot);
    await files.collect(reopened, new Date("2040-01-01"));
    await fs.stat(path.join(directory, recovery));
  } finally {
    await files.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("chunked persistence snapshots mutable metadata and round-trips escaped surrogate boundaries", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "issue91-json-"));
  const files = new LocalFiles(directory);
  try {
    const state = await files.open("domain", "fixture");
    const text = "x".repeat(65535) + '👨‍👩‍👧‍👦\n\t"\\';
    state.drafts.Main = {
      raw: text,
      generation: 1,
      snapshot: plainSnapshot(text),
    };
    const job = files.save(state);
    state.drafts.Main.raw = "later";
    state.drafts.Main.generation = 2;
    state.drafts.Main.snapshot!.cursor.col = 0;
    await job;
    const saved = JSON.parse(
      await fs.readFile(path.join(directory, "state.json"), "utf8"),
    );
    assert.equal(saved.drafts.Main.raw, text);
    assert.equal(saved.drafts.Main.generation, 1);
    assert.deepEqual(saved.drafts.Main.snapshot, plainSnapshot(text));
  } finally {
    await files.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
