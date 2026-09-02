# execution.task

## 1. 定义

`task` 保存持久任务的目标、成功条件、约束、风险等级、调度状态和当前版本。它是任务当前状态的权威记录，不保存完整执行日志，也不依赖模型会话维持连续性。

权威写入者为 Task Service。模型只生成 Task Proposal，不能直接创建、完成、失败或取消 Task。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `task_id` | `uuid` | 是 | 主键 |
| `parent_task_id` | `uuid` | 否 | 父任务 |
| `source_interaction_id` | `uuid` | 否 | 来源交互 |
| `source_decision_id` | `uuid` | 是 | 提出任务的 Decision Record |
| `request_key` | `text` | 是 | 调用方稳定去重键 |
| `goal` | `text` | 是 | 明确的任务目标 |
| `success_criteria` | `jsonb` | 是 | 带稳定 `criterion_id` 的可验证条件列表 |
| `constraints` | `jsonb` | 是 | 行为、权限、成本、时间和范围约束 |
| `priority` | `text` | 是 | `LOW`、`NORMAL`、`HIGH` 或 `CRITICAL` |
| `risk_class` | `text` | 是 | 采用设计文档的六级风险分类 |
| `status` | `text` | 是 | 采用任务状态机 |
| `status_reason_code` | `text` | 否 | 受控状态原因 |
| `next_wakeup_at` | `timestamptz` | 否 | 时间唤醒点 |
| `wakeup_condition` | `jsonb` | 否 | 事件或外部状态条件 |
| `completion_evidence_refs` | `uuid[]` | 是 | 成功条件验证证据 |
| `version` | `bigint` | 是 | 乐观并发与事件序号版本 |
| `created_at` | `timestamptz` | 是 | 创建时间 |
| `updated_at` | `timestamptz` | 是 | 最近更新时间 |
| `terminal_at` | `timestamptz` | 否 | 进入终态的时间 |

任务状态：`CREATED`、`READY`、`RUNNING`、`WAITING_EXTERNAL`、`WAITING_APPROVAL`、`BLOCKED`、`COMPLETED`、`FAILED`、`CANCELLED`。

风险等级：`READ_ONLY`、`REVERSIBLE`、`EXTERNAL_WRITE`、`DESTRUCTIVE`、`FINANCIAL`、`IDENTITY`。

## 3. 不可变量

1. `(source_decision_id, request_key)` 唯一；重复请求返回同一任务或明确去重结果。
2. `COMPLETED` 必须证明全部成功条件已满足，不能只依赖 Worker 的 `success=true`。
3. 状态变化必须满足任务状态机，并同时追加 `task_event`。
4. 业务更新、对应 `task_event` 和 `outbox_event` 必须在同一事务中提交。
5. 子任务不能放宽父任务适用于其范围的风险和权限约束。
6. `WAITING_EXTERNAL` 或 `WAITING_APPROVAL` 必须包含可解释的唤醒条件。
7. 所有更新必须比较 `version`，冲突时重新读取和规划。

## 4. 关系与索引

- 引用 Interaction Event、Decision Record 和 Evidence Index。
- 被 Task Step、Action、Task Event、Artifact 和 Task Projection 引用。
- 唯一索引：`(source_decision_id, request_key)`。
- 调度索引：`(status, next_wakeup_at, priority)`。
- 父子索引：`parent_task_id`。
- 活跃任务索引：`(status, updated_at)`，排除终态。

## 5. 示例

```yaml
task_id: 0199a900-0000-7000-8000-000000000001
source_interaction_id: 0199aa00-0000-7000-8000-000000000001
source_decision_id: 0199aa10-0000-7000-8000-000000000001
request_key: secretary-datastructure-20260902
goal: 完成 Secretary 各逻辑层数据结构设计
success_criteria:
  - criterion_id: all-structures-documented
    statement: 每个数据结构均有独立文档
    status: PENDING
constraints:
  - 不改变既有逻辑层边界
priority: HIGH
risk_class: REVERSIBLE
status: RUNNING
completion_evidence_refs: []
version: 4
created_at: 2026-09-02T04:30:00Z
updated_at: 2026-09-02T05:20:00Z
```
