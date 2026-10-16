import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Store,
  id,
  MESSAGE_LIST_MEDIA,
} from "../../../src/pi_secretary/src/store.ts";
import { saveContext } from "../../../src/pi_secretary/src/context.ts";
import type { AgentMessage } from "../../../src/pi_secretary/src/model.ts";
test("old arrays and encoded Context preserve exact messages, source content and restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue24-context-"));
  let store = await Store.open(dir);
  try {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "中文 duplicate" },
          { type: "image", data: "YWJj", mimeType: "image/png" },
        ],
        timestamp: 1,
      },
    ];
    messages.push(structuredClone(messages[0]));
    const old = store.put(messages);
    const context = saveContext(
      store,
      messages,
      { session_id: null, task_id: null, execution_id: null },
      "TASK",
      "fixture",
      id(),
    );
    const encoded = context.raw_context;
    assert.equal(encoded.media_type, MESSAGE_LIST_MEDIA);
    assert.deepEqual(store.read(encoded), store.read(old));
    assert.equal(store.contentBytes(encoded), old.bytes);
    assert.equal(store.contentText(encoded), store.bytes(old).toString());
    const list = JSON.parse(store.bytes(encoded).toString());
    assert.deepEqual(
      list.messages,
      context.messages.map((m) => m.content),
    );
    await store.close();
    store = await Store.open(dir);
    assert.deepEqual(store.read(encoded), messages);
    assert.deepEqual(store.read(store.putMessages([]).raw), []);
    for (const bad of [
      { encoding: "future", messages: [] },
      { encoding: "message-refs-v1", messages: [encoded] },
      { encoding: "message-refs-v1", messages: [], extra: true },
    ])
      assert.throws(
        () => store.read(store.put(bad, MESSAGE_LIST_MEDIA)),
        /INVALID_MESSAGE_LIST/,
      );
    fs.writeFileSync(
      path.join(dir, list.messages[0].path),
      "x".repeat(list.messages[0].bytes),
    );
    assert.throws(() => store.read(encoded), /CORRUPT_OBJECT/);
  } finally {
    await store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
