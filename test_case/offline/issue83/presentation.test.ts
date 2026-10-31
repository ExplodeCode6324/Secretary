import test from "node:test";
import assert from "node:assert/strict";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import {
  taskCardText,
  taskGroupText,
  taskExecutionText,
} from "../../../src/pi_secretary/src/tui/task-presentation.ts";
import { safeText } from "../../../src/pi_secretary/src/tui/view.ts";
import type {
  TaskBrowserTask,
  TaskBrowserExecution,
} from "../../../src/pi_secretary/src/api/contracts.ts";
const execution: TaskBrowserExecution = {
  id: "exec-full-id",
  state: "RUNNING",
  kind: "AGENT",
  retention_state: "HOT",
  created_at: "2026-11-01T00:00:00.000Z",
  created_sequence: "1",
  started_at: "2026-11-01T00:01:00.000Z",
  ended_at: null,
  invoked_at: "2026-11-01T00:01:00.000Z",
  ordering_source: "started_at",
  history_availability: "recorded",
};
const task: TaskBrowserTask = {
  id: "12345678-0000-4000-8000-000000000001",
  scope_id: null,
  scope_name: "Shared",
  revision: "1",
  goal: "整理任务报告",
  goal_truncated: false,
  state: "PAUSED",
  executor: "AGENT",
  trigger: "IMMEDIATE",
  next_due_at: null,
  deadline: null,
  schedule_status: "not_scheduled",
  current_reasons: ["nonterminal_execution"],
  active_executions: [execution],
  latest_execution: execution,
  pending_request_count: 0,
  pending_occurrence_count: 0,
  pending_due_at: null,
  attention_ids: [],
  unknown_operation_ids: [],
  latest_result: null,
  latest_result_observed_at: null,
  initialization_error: null,
  current: true,
};

test("Task presentation preserves separate plan/execution states and sanitizes data before adding colors", () => {
  const text = taskCardText(
    {
      ...task,
      goal: "报告\x1b[31m注入\x1b[0m\x1b]52;c;EVIL\x07",
      attention_ids: ["attention-id"],
      unknown_operation_ids: ["operation-full-id"],
    },
    true,
    true,
  );
  assert(!text.includes("\x1b[31m"));
  assert(!text.includes("EVIL"));
  assert(!text.includes("\x07"));
  assert(text.includes("\x1b[38;5;218m注意"));
  assert(text.includes("\x1b[38;5;153m运行中"));
  const plain = safeText(text);
  assert.match(plain, /计划.*已暂停/);
  assert.match(plain, /执行.*运行中/);
  assert(plain.includes(task.id));
  assert(plain.includes("attention-id"));
  assert(plain.includes("operation-full-id"));
  assert(plain.includes(execution.started_at!));
  assert.equal(
    safeText(taskGroupText("Scope\n伪造行\x1b[2J", 2, false))
      .trim()
      .split("\n").length,
    1,
  );
  for (const width of [80, 120])
    for (const line of new Text(text, 0, 0).render(width))
      assert(visibleWidth(line) <= width);
});

test("ended failure is labelled historical execution; bounded summaries never masquerade as full content", () => {
  const ended = {
    ...execution,
    state: "FAILED",
    ended_at: "2026-11-01T00:02:00.000Z",
    retention_state: "RETIRED",
    history_availability: "no_recorded_messages",
  };
  const text = taskCardText({
    ...task,
    goal: "长目标".repeat(100),
    active_executions: [],
    latest_execution: ended,
    current_reasons: ["actionable_failure"],
    latest_result: "FAILED: " + "长结果".repeat(100),
    latest_result_observed_at: ended.ended_at,
  });
  const plain = safeText(text);
  assert.match(plain, /执行.*当前无进行中的执行/);
  assert.match(plain, /注意.*最近执行失败/);
  assert.match(plain, /最近.*失败/);
  assert(!plain.includes("运行中"));
  assert(plain.includes("目标预览"));
  assert(plain.includes("预览；详情查看全文"));
  assert(plain.includes("结果观测: " + ended.ended_at));
  const header = safeText(taskExecutionText(ended, 0, 3));
  assert(header.includes(ended.id));
  assert(header.includes("已退役"));
  assert(!header.includes("仍可浏览"));
});
