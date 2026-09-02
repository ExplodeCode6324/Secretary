# cognition.goal

## 1. 定义

`goal` 保存 Master 或 Secretary 在已授权范围内需要持续追踪的当前目标和长期目标。Goal 描述期望结果，不等同于 Task 的执行计划。

权威写入者为 Goal Service。来自模型的目标仅作为提案，经来源、权限和去重校验后才能登记。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `goal_id` | `uuid` | 是 | 主键 |
| `owner_entity_id` | `uuid` | 是 | 目标所有者，通常为 Master |
| `parent_goal_id` | `uuid` | 否 | 上级目标 |
| `source_interaction_id` | `uuid` | 否 | Master 输入来源 |
| `source_task_id` | `uuid` | 否 | 从任务结果派生时的来源任务 |
| `statement` | `text` | 是 | 明确、可解释的目标陈述 |
| `success_criteria` | `jsonb` | 是 | 可逐项验证的条件列表 |
| `constraints` | `jsonb` | 是 | 权限、时间、成本和行为约束 |
| `priority` | `text` | 是 | `LOW`、`NORMAL`、`HIGH` 或 `CRITICAL` |
| `horizon` | `text` | 是 | `IMMEDIATE`、`SHORT_TERM`、`LONG_TERM` 或 `ONGOING` |
| `status` | `text` | 是 | `ACTIVE`、`PAUSED`、`ACHIEVED`、`ABANDONED` 或 `EXPIRED` |
| `valid_from` | `timestamptz` | 是 | 目标生效时间 |
| `target_at` | `timestamptz` | 否 | 期望完成时间 |
| `valid_to` | `timestamptz` | 否 | 目标终止时间 |
| `completion_evidence_refs` | `uuid[]` | 是 | 达成状态的验证依据 |
| `version` | `bigint` | 是 | 乐观并发版本 |
| `created_at` | `timestamptz` | 是 | 创建时间 |
| `updated_at` | `timestamptz` | 是 | 最近更新时间 |

## 3. 不可变量

1. `ACHIEVED` 必须有全部成功条件的验证记录或 Master 明确确认。
2. Goal 不得包含执行凭据或未受控的外部操作授权。
3. 子目标的约束不得弱于父目标适用于该范围的约束。
4. `ABANDONED` 和 `EXPIRED` 不删除历史关联任务。
5. 目标更新使用版本检查，并形成可审计状态事件。

## 4. 关系与索引

- `owner_entity_id -> cognition.entity.entity_id`。
- `source_interaction_id -> interaction.interaction_event.interaction_event_id`。
- `source_task_id -> execution.task.task_id`。
- 活跃目标索引：`(owner_entity_id, status, priority, target_at)`。
- 层级索引：`parent_goal_id`。

## 5. 示例

```yaml
goal_id: 0199a830-0000-7000-8000-000000000001
owner_entity_id: 0199a100-0000-7000-8000-000000000001
statement: 完成 Secretary 数据结构逻辑设计
success_criteria:
  - id: criterion-1
    text: 每个逻辑数据结构均有独立文档
    status: PENDING
constraints:
  - 不改变既有架构边界
priority: HIGH
horizon: SHORT_TERM
status: ACTIVE
valid_from: 2026-09-02T04:30:00Z
completion_evidence_refs: []
version: 1
created_at: 2026-09-02T04:30:00Z
updated_at: 2026-09-02T04:30:00Z
```
