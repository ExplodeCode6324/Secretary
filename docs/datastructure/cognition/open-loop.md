# cognition.open_loop

## 1. 定义

`open_loop` 保存当前尚未闭环且需要进入注意力筛选的事项。它主要由 Task Projection 生成，也可来源于 Goal、承诺或需要跟进的 Observation。

Open Loop 是可重建投影，不是 Task 或 Goal 的权威状态。权威写入者为 Task Projector 或受控 Open Loop Projector。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `open_loop_id` | `uuid` | 是 | 主键 |
| `owner_entity_id` | `uuid` | 是 | 事项所属主体 |
| `source_type` | `text` | 是 | `TASK`、`GOAL`、`COMMITMENT` 或 `OBSERVATION` |
| `source_id` | `uuid` | 是 | 来源结构标识 |
| `source_version` | `bigint` | 是 | 来源版本 |
| `summary` | `text` | 是 | 有界事实性摘要 |
| `status` | `text` | 是 | `OPEN`、`WAITING`、`BLOCKED` 或 `CLOSED` |
| `importance` | `integer` | 是 | `0..100`，仅供排序 |
| `blocking_reason` | `text` | 否 | 机器安全的阻塞摘要 |
| `next_wakeup_at` | `timestamptz` | 否 | 时间唤醒条件 |
| `next_wakeup_condition` | `jsonb` | 否 | 事件或状态唤醒条件 |
| `task_projection_id` | `uuid` | 否 | 来源为任务时的投影 |
| `last_significant_change_at` | `timestamptz` | 是 | 最近显著变化时间 |
| `version` | `bigint` | 是 | 投影版本 |
| `projected_at` | `timestamptz` | 是 | 生成时间 |
| `expires_at` | `timestamptz` | 否 | 缓存失效时间 |

## 3. 不可变量

1. `(source_type, source_id)` 最多存在一个非 `CLOSED` Open Loop。
2. Open Loop 状态不得反向更新来源 Task 或 Goal。
3. 来源状态变化后必须生成新投影版本或关闭旧投影。
4. `summary` 不得包含完整任务日志、原始文件、凭据或未脱敏证据。
5. `importance` 只影响排序，不能改变授权或风险策略。

## 4. 关系与索引

- `owner_entity_id -> cognition.entity.entity_id`。
- `task_projection_id -> execution.task_projection.projection_id`。
- 唯一活动索引：`(source_type, source_id)` 条件为 `status <> CLOSED`。
- 意识构建索引：`(owner_entity_id, status, importance desc, last_significant_change_at desc)`。
- 唤醒索引：`(status, next_wakeup_at)`。

## 5. 示例

```yaml
open_loop_id: 0199a840-0000-7000-8000-000000000001
owner_entity_id: 0199a100-0000-7000-8000-000000000001
source_type: TASK
source_id: 0199a900-0000-7000-8000-000000000001
source_version: 6
summary: Secretary 数据结构设计正在进行一致性检查
status: OPEN
importance: 80
task_projection_id: 0199a970-0000-7000-8000-000000000001
last_significant_change_at: 2026-09-02T05:00:00Z
version: 6
projected_at: 2026-09-02T05:00:00.050Z
```
