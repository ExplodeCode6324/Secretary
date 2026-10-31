import type {
  TaskBrowserExecution,
  TaskBrowserTask,
} from "../api/contracts.ts";
import { color } from "./input.ts";
import { safeText } from "./view.ts";

// Apply our palette only after stripping terminal control sequences from data.
const paint = (sgr: string) => (text: string) => color(sgr)(safeText(text));
const ink = paint("37"),
  goalInk = paint("1;37"),
  muted = paint("38;5;245"),
  heading = paint("1;38;5;153"),
  pink = paint("38;5;218"),
  amber = paint("38;5;223"),
  mint = paint("38;5;151"),
  blue = paint("38;5;153");
const states: Record<string, string> = {
  INITIALIZING: "初始化中",
  ACTIVE: "有效",
  PAUSED: "已暂停",
  INIT_FAILED: "初始化失败",
  CLOSED: "已结束",
  CREATED: "已创建",
  READY: "就绪",
  WAIT_PRECONDITION: "等待前置条件",
  RUNNING: "运行中",
  DISPATCHING: "分发中",
  WAIT_AUTH: "等待授权",
  WAIT_DECISION: "等待决策",
  CANCEL_REQUESTED: "正在取消",
  RESULT_UNKNOWN: "结果待核实",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
  EXPIRED: "已到期",
};
const name = (state: string) => states[state] ?? state;
const tone = (state: string) =>
  [
    "FAILED",
    "INIT_FAILED",
    "RESULT_UNKNOWN",
    "WAIT_AUTH",
    "WAIT_DECISION",
  ].includes(state)
    ? pink
    : ["RUNNING", "DISPATCHING"].includes(state)
      ? blue
      : state === "SUCCEEDED"
        ? mint
        : [
              "CREATED",
              "READY",
              "WAIT_PRECONDITION",
              "INITIALIZING",
              "PAUSED",
              "CANCEL_REQUESTED",
            ].includes(state)
          ? amber
          : muted;
const triggers: Record<string, string> = {
  IMMEDIATE: "立即触发",
  AT: "定时触发",
  INTERVAL: "周期触发",
  EVENT: "事件触发",
};
const oneLine = (value: string, limit: number) => {
  const chars = Array.from(safeText(value).replace(/\s+/g, " ").trim());
  return {
    text: chars.slice(0, limit).join(""),
    clipped: chars.length > limit,
  };
};
const preview = (value: string, limit = 120) => {
  const p = oneLine(value, limit);
  return p.text + (p.clipped ? " …（预览；详情查看全文）" : "");
};
const invocation = (e: TaskBrowserExecution) =>
  `${e.ordering_source === "started_at" ? "开始" : e.ordering_source === "created_at" ? "创建（尚未开始）" : "调用时间"}: ${e.invoked_at ?? "未知"}`;
export const taskTitleText = (title: string, context: string, help: string) =>
  [
    heading(title),
    muted(safeText(context).replace(/\s+/g, " ")),
    muted(help),
    "",
  ].join("\n");
export const taskGroupText = (
  title: string,
  count: number,
  continued: boolean,
) =>
  `\n${heading("── " + safeText(title).replace(/\s+/g, " "))} ${muted(`${count} 个当前任务${continued ? " · 续" : ""}`)}\n`;

export function taskCardText(
  t: TaskBrowserTask,
  selected = false,
  detail = false,
) {
  const goal = oneLine(t.goal, 100);
  const lines = [
    (selected ? pink : goalInk)(
      (selected ? "▶ 已定位 · " : "● ") +
        goal.text +
        (goal.clipped || t.goal_truncated
          ? " …（目标预览；详情查看全文）"
          : ""),
    ),
    `  ${muted("计划")}  ${tone(t.state)(name(t.state))} ${muted(`· ${t.executor === "AGENT" ? "Agent" : "程序"} · ${triggers[t.trigger] ?? t.trigger}${t.current ? "" : " · 历史任务"}`)}`,
  ];
  for (const e of t.active_executions)
    lines.push(
      `  ${muted("执行")}  ${tone(e.state)(name(e.state))} ${muted("· " + invocation(e))}`,
    );
  if (!t.active_executions.length)
    lines.push(
      `  ${muted("执行")}  ${muted(t.latest_execution ? "当前无进行中的执行" : "尚未执行")}`,
    );
  const attention: string[] = [];
  if (t.current_reasons.includes("actionable_failure"))
    attention.push("最近执行失败");
  if (t.attention_ids.length)
    attention.push(`授权/决策事项 ${t.attention_ids.length} 项`);
  if (t.unknown_operation_ids.length)
    attention.push(`结果待核实 ${t.unknown_operation_ids.length} 项`);
  if (t.initialization_error)
    attention.push("初始化错误：" + preview(t.initialization_error));
  if (t.schedule_status === "deadline_ineligible")
    attention.push("下一次触发已超出截止时间");
  if (t.schedule_status === "unsupported_trigger")
    attention.push("事件触发当前不受支持");
  if (attention.length)
    lines.push(`  ${pink("注意  " + attention.join(" · "))}`);
  if (detail) {
    for (const id of t.attention_ids)
      lines.push(`  ${muted("事项 ID  " + id)}`);
    for (const id of t.unknown_operation_ids)
      lines.push(`  ${pink("待核实 Operation")}  ${muted(id)}`);
  }
  if (t.pending_request_count || t.pending_occurrence_count)
    lines.push(
      `  ${amber(`排队  请求 ${t.pending_request_count} · 定时触发 ${t.pending_occurrence_count}`)}`,
    );
  if (t.next_due_at || t.pending_due_at)
    lines.push(
      `  ${muted("时间  " + [t.next_due_at ? `计划下次: ${t.next_due_at}${t.schedule_status !== "scheduled" ? "（当前不调度）" : ""}` : "", t.pending_due_at ? `排队到期: ${t.pending_due_at}` : ""].filter(Boolean).join(" · "))}`,
    );
  const latest = t.latest_execution;
  if (latest && !t.active_executions.some((e) => e.id === latest.id)) {
    lines.push(
      `  ${muted("最近")}  ${tone(latest.state)(name(latest.state))} ${muted("· " + invocation(latest))}`,
    );
    if (latest.ended_at)
      lines.push(`  ${muted("      结束: " + latest.ended_at)}`);
  }
  if (t.latest_result) {
    const result = t.latest_result.replace(
      /^([A-Z_]+):\s*/,
      (_, s: string) => name(s) + "：",
    );
    lines.push(
      `  ${muted("结果")}  ${latest ? tone(latest.state)(preview(result)) : ink(preview(result))}`,
    );
  }
  if (t.latest_result_observed_at)
    lines.push(`  ${muted("结果观测: " + t.latest_result_observed_at)}`);
  lines.push(`  ${muted("ID    " + t.id)}`, "");
  return lines.join("\n");
}

export function taskExecutionText(
  e: TaskBrowserExecution,
  index: number,
  count: number,
) {
  return [
    "",
    heading(
      `── 最近执行 ${index + 1}/${count} · ${e.kind === "AGENT" ? "Agent" : "程序"}`,
    ),
    `  ${tone(e.state)(name(e.state))} ${muted("· " + invocation(e))}`,
    ...(e.ended_at ? [muted("  结束: " + e.ended_at)] : []),
    muted(
      `  ID    ${e.id} · ${e.retention_state === "RETIRED" ? "已退役" : e.retention_state === "ARCHIVE_PENDING" ? "等待归档" : "保留中"}`,
    ),
    "",
  ].join("\n");
}
