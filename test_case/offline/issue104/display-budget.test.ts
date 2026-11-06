import test from "node:test";
import assert from "node:assert/strict";
import {
  tailMessageBody,
  bodyBytes,
} from "../../../src/pi_secretary/src/tui/body.ts";
import { messageComponent } from "../../../src/pi_secretary/src/tui/view.ts";
import { TaskBrowserWindow } from "../../../src/pi_secretary/src/tui/task-browser.ts";
import type { Message } from "../../../src/pi_secretary/src/api/contracts.ts";
const message: Message = {
  id: "call:x",
  kind: "message",
  role: "assistant",
  text: "truncated preview tail",
  revision: "1",
  call_id: null,
  next_cursor: null,
  persistence: "transient",
  incomplete: true,
  preview_status: "running",
  truncated: true,
  task_id: "t",
  execution_id: "e",
};
test("live truncated tail must identify missing format context", () => {
  const body = tailMessageBody(message, false);
  assert(body.body.contextBoundary);
});
test("live Task output must visibly distinguish unsaved preview", () => {
  const lines = messageComponent(message, false, undefined, false, "Agent")
    .render(80)
    .join("\n");
  assert.match(lines, /预览|未保存|正在生成/);
});
test("Task metadata and render-body references fit total history budget", () => {
  const b = new TaskBrowserWindow(
    {
      query: async () => {
        throw Error("unused");
      },
    },
    () => true,
  );
  (b as any).detail = {
    id: "detail",
    task_id: "t",
    kind: "message",
    role: "system",
    revision: "1",
    text: "detail",
    task: {
      scope_name: "scope",
      current_reasons: [],
      active_executions: [],
      latest_execution: null,
    },
    executions: [{ id: "e" }],
  };
  b.selected = "t";
  b.groups.set("e", {
    items: Array.from({ length: 200 }, (_, i) => ({
      ...message,
      id: "m" + i,
      text: "界".repeat(4096),
      thinking: "思".repeat(4096),
    })),
    before: false,
    after: false,
    availability: "recorded",
  });
  (b as any).prune();
  const bytes = [...b.groups.values()]
    .flatMap((g) => g.items)
    .reduce(
      (n, m) =>
        n + Buffer.byteLength(m.text) + Buffer.byteLength(m.thinking ?? ""),
      0,
    );
  assert(bytes <= 4 * 1024 * 1024, `retained ${bytes}`);
  b.stop();
});

test("released bodies do not remain retained by the render cache", () => {
  const b = new TaskBrowserWindow(
    {
      query: async () => {
        throw Error("unused");
      },
    },
    () => false,
  );
  (b as any).detail = {
    id: "detail",
    task_id: "t",
    kind: "message",
    role: "system",
    revision: "1",
    text: "detail",
    executions: [{ id: "e" }],
  };
  b.groups.set("e", {
    items: [message],
    before: false,
    after: false,
    availability: "recorded",
  });
  const body = tailMessageBody(
    { ...message, text: "x".repeat(1024 * 1024) },
    false,
  );
  b.bodies.set("e:call:x", body);
  (b as any).messageEntry(message);
  assert((b as any).entryCache.get("e:call:x").body === body);
  b.bodies.delete("e:call:x");
  (b as any).prune();
  assert(!(b as any).entryCache.has("e:call:x"));
  b.stop();
});
