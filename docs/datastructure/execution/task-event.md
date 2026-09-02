# execution.task_event

## 1. 定义

`task_event` 是任务与相关步骤、动作发生状态变化时形成的追加式审计事件。它用于重放、审计和投影，不取代 `task` 的当前状态快照。

权威写入者为 Task Service。事件必须与对应业务状态更新在同一事务中提交。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `task_event_id` | `uuid` | 是 | 主键 |
| `task_id` | `uuid` | 是 | 所属任务 |
| `task_version` | `bigint` | 是 | 事件提交后的任务版本 |
| `event_type` | `text` | 是 | 稳定事件类型 |
| `from_status` | `text` | 否 | 状态变化前值 |
| `to_status` | `text` | 否 | 状态变化后值 |
| `step_id` | `uuid` | 否 | 相关步骤 |
| `action_id` | `uuid` | 否 | 相关动作 |
| `actor_type` | `text` | 是 | `MASTER`、`SERVICE`、`WORKER` 或 `SYSTEM` |
| `actor_id` | `text` | 是 | 主体或组件稳定标识 |
| `cause_type` | `text` | 是 | 交互、决策、观察、授权、超时或系统恢复 |
| `cause_ref` | `uuid` | 是 | 原因记录标识 |
| `payload` | `jsonb` | 是 | 事件类型对应的最小机器载荷 |
| `idempotency_key` | `text` | 是 | 同一变化的去重键 |
| `occurred_at` | `timestamptz` | 是 | 业务变化时间 |
| `recorded_at` | `timestamptz` | 是 | 事件持久化时间 |
| `trace_id` | `uuid` | 是 | 跨层追踪标识 |

## 3. 不可变量

1. `task_event` 创建后不可修改或删除。
2. `(task_id, task_version)` 唯一，并按版本连续增长。
3. 状态事件的 `from_status` 必须等于事务开始时 Task 状态，`to_status` 必须等于事务提交后的状态。
4. 相同 `idempotency_key` 的重复命令不得追加第二个事件。
5. 事件载荷不保存完整日志、凭据或可变对象内容。
6. 事件不能脱离 Task 当前状态单独宣告任务完成。

## 4. 关系与索引

- 引用 Task、Task Step、Action 和各类 cause 记录。
- 被 Task Projection、Salience 和 Outbox Event 使用。
- 唯一索引：`(task_id, task_version)`、`(task_id, idempotency_key)`。
- 重放索引：`(task_id, task_version)`。
- 全局时间索引：`(recorded_at, task_event_id)`；建议按月分区。

## 5. 示例

```yaml
task_event_id: 0199a940-0000-7000-8000-000000000001
task_id: 0199a900-0000-7000-8000-000000000001
task_version: 4
event_type: task.status_changed
from_status: READY
to_status: RUNNING
actor_type: SERVICE
actor_id: task-service/v1
cause_type: DECISION
cause_ref: 0199aa10-0000-7000-8000-000000000001
payload:
  reason_code: FIRST_STEP_READY
idempotency_key: task:0199a900:start:v4
occurred_at: 2026-09-02T04:31:00Z
recorded_at: 2026-09-02T04:31:00.010Z
trace_id: 0199a940-0000-7000-8000-000000000099
```
