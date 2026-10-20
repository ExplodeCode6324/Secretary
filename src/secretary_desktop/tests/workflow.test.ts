import test from "node:test";
import assert from "node:assert/strict";
import { conversation, approvalProblem, previews } from "../src/workflow";
import type { Message, Timeline, Authorization } from "../src/contracts";
const m: Message = {
  id: "message:call",
  kind: "message",
  call_id: "call",
  role: "assistant",
  revision: "1",
  text: "",
  incomplete: false,
  next_cursor: null,
  persistence: "transient",
};
const page = (items: Message[]): Timeline => ({
  items,
  version: "1",
  generation: "1",
  before: null,
  after: null,
});
const live = {
  previews: [
    {
      id: "call",
      at: "2026-10-20",
      status: "running",
      truncated: false,
      blocks: [{ type: "text", text: "实时文本" }],
    },
  ],
};
test("in-flight empty API row does not erase preview; final wins over late snapshots and paging", () => {
  const done = new Set<string>();
  assert.equal(
    (conversation(page([m]), live, done)[0] as Message).text,
    "实时文本",
  );
  const final = { ...m, persistence: "durable" as const, text: "最终文本" };
  assert.equal(
    (conversation(page([final]), live, done)[0] as Message).text,
    "最终文本",
  );
  assert.equal(conversation(page([]), live, done).length, 0);
  assert.equal(
    conversation(page([{ ...final, text: "" }]), live, done).length,
    1,
  );
});
test("unknown finality retains real preview and transient omission is not a deletion of durable data", () => {
  assert.equal(
    (
      conversation(
        page([{ ...m, persistence: undefined }]),
        live,
        new Set(),
      )[0] as Message
    ).text,
    "实时文本",
  );
  assert.equal(
    conversation(page([{ ...m, persistence: "durable" }]), null, new Set())
      .length,
    1,
  );
  assert.deepEqual(previews({ previews: [{ id: 1 }] }), []);
});
const auth: Authorization = {
  id: "a",
  revision: "9007199254740993",
  state: "PENDING",
  display_hash: "hash",
  expires_at: null,
  scope: { session_id: null, task_id: null, execution_id: null },
  display: { action: "shell.run", parameters: { command: "safe" } },
};
test("consent requires complete current data, no pending intent, and a live deadline", () => {
  assert.equal(approvalProblem(auth, 0, false), "");
  assert(approvalProblem(auth, 0, true));
  assert(approvalProblem({ ...auth, display: undefined }, 0, false));
  assert(approvalProblem({ ...auth, state: "REJECTED" }, 0, false));
  assert(approvalProblem({ ...auth, state: "UNKNOWN_EXTENSION" }, 0, false));
  assert(
    approvalProblem({ ...auth, expires_at: "2026-01-01" }, Date.now(), false),
  );
});
