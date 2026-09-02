# ConsciousnessStateInput

## 1. 定义

`ConsciousnessStateInput` 是一次模型调用实际接收的当前意识结构。它把相关 `LiveWorldStateInput`、`WorldModelInput`、活跃目标、Open Loop 和近期显著变化组合为有界输入，同时保留每个组成部分的权威来源和截断信息。

该结构只负责认知输入，不包含系统提示、治理规则、工具凭据、完整任务日志或原始证据正文。

## 2. 顶层结构

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `schema_version` | `integer` | 是 | 初始为 `1` |
| `input_type` | `string` | 是 | 固定为 `consciousness_state_input` |
| `snapshot_id` | `uuid` | 是 | `consciousness_snapshot.snapshot_id` |
| `generated_at` | `timestamp` | 是 | 快照生成时间 |
| `as_of` | `timestamp` | 是 | 输入数据共同水位 |
| `subject` | `EntityRef` | 是 | 当前服务主体 |
| `trigger` | `object` | 是 | 触发类型、标识和安全摘要 |
| `live_world_state` | `LiveWorldStateInput` | 是 | 实时状态投影 |
| `world_model` | `WorldModelInput` | 是 | 长期认知切片 |
| `active_goals` | `array<GoalProjection>` | 是 | 活跃目标投影 |
| `open_loops` | `array<OpenLoopProjection>` | 是 | 未闭环事项投影 |
| `recent_changes` | `array<ChangeProjection>` | 是 | 近期显著变化 |
| `budget` | `object` | 是 | 各区段预算与实际使用量 |
| `coverage` | `object` | 是 | 全局截断和缺失说明 |
| `integrity` | `object` | 是 | 组成哈希和最终载荷哈希 |

## 3. trigger

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `type` | `string` | 是 | `INTERACTION`、`OBSERVATION`、`TASK_EVENT` 或 `SCHEDULE` |
| `ref` | `uuid` | 是 | 触发记录标识 |
| `occurred_at` | `timestamp` | 是 | 触发发生时间 |
| `summary` | `string` | 是 | 已脱敏、有界摘要；外部内容仍按数据处理 |

触发摘要不得包含治理指令的解释结果。任何外部文档、邮件、网页、仓库或工具输出中的指令性文本均保持不可信数据语义。

## 4. GoalProjection

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `goal_id` | `uuid` | 是 | Goal 标识 |
| `goal_version` | `integer` | 是 | 精确版本 |
| `statement` | `string` | 是 | 目标陈述 |
| `priority` | `string` | 是 | 目标优先级 |
| `status` | `string` | 是 | 正常为 `ACTIVE` 或 `PAUSED` |
| `success_criteria_summary` | `array<string>` | 是 | 有界成功条件摘要 |
| `constraints` | `array<string>` | 是 | 对本次判断有效的约束摘要 |
| `target_at` | `timestamp|null` | 是 | 可空目标时间 |
| `relevance_score` | `number` | 是 | `[0,1]` |

## 5. OpenLoopProjection

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `open_loop_id` | `uuid` | 是 | Open Loop 标识 |
| `source_type` | `string` | 是 | `TASK`、`GOAL`、`COMMITMENT` 或 `OBSERVATION` |
| `source_id` | `uuid` | 是 | 权威来源标识 |
| `source_version` | `integer` | 是 | 来源精确版本 |
| `summary` | `string` | 是 | 有界摘要 |
| `status` | `string` | 是 | `OPEN`、`WAITING` 或 `BLOCKED` |
| `blocking_reason` | `string|null` | 是 | 可空阻塞原因 |
| `next_wakeup` | `object|null` | 是 | 时间或事件唤醒条件 |
| `last_significant_change_at` | `timestamp` | 是 | 最近显著变化时间 |
| `relevance_score` | `number` | 是 | `[0,1]` |

## 6. ChangeProjection

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `change_id` | `uuid` | 是 | 通常为 Observation 或 Task Event 标识 |
| `change_type` | `string` | 是 | 版本化变化类型 |
| `occurred_at` | `timestamp` | 是 | 变化发生时间 |
| `summary` | `string` | 是 | 可追溯、无完成性夸大的摘要 |
| `source_ref` | `object` | 是 | 来源类型、标识和版本 |
| `evidence_refs` | `array<uuid>` | 是 | 关键证据标识 |
| `salience_score` | `number` | 是 | `[0,1]` |

## 7. 预算与截断

`budget` 至少包含：

```yaml
max_total_tokens: 6000
reserved_response_tokens: 1500
sections:
  live_world_state:
    max_items: 16
    estimated_tokens: 900
  world_model:
    max_items: 24
    estimated_tokens: 1600
  active_goals:
    max_items: 8
    estimated_tokens: 400
  open_loops:
    max_items: 12
    estimated_tokens: 600
  recent_changes:
    max_items: 12
    estimated_tokens: 500
```

`coverage` 至少包含：

```yaml
truncated: true
truncated_sections:
  - world_model
omitted_counts:
  live_world_state: 1
  world_model: 3
  active_goals: 0
  open_loops: 0
  recent_changes: 2
absence_semantics: OMITTED_OR_MISSING_DOES_NOT_MEAN_FALSE
```

当区段被截断时，模型必须在需要完整性保证的任务中请求补充检索，不得凭当前切片作出全量结论。

## 8. integrity

`integrity` 至少包含：

| 字段 | 类型 | 语义 |
|---|---|---|
| `live_world_state_hash` | `string` | 实时状态投影哈希 |
| `world_model_hash` | `string` | 长期认知投影哈希 |
| `goals_hash` | `string` | 目标区段哈希 |
| `open_loops_hash` | `string` | 未闭环事项区段哈希 |
| `recent_changes_hash` | `string` | 变化区段哈希 |
| `payload_hash` | `string` | 完整规范化载荷哈希 |
| `hash_algorithm` | `string` | 初始为 `sha256` |

这些哈希由 `interaction.decision_record` 保存，用于证明模型实际看到的输入，不用于事实去重。

## 9. 不可变量

1. `snapshot_id` 必须与两个子投影的 `integrity.snapshot_id` 一致。
2. 各区段只能包含精确版本引用，禁止 latest 或无版本可变链接。
3. `as_of` 不得晚于任一子投影的数据水位。
4. 当前状态与长期事实语义不得合并。临时状态不能因进入意识快照而晋升为长期事实。
5. 目标和 Open Loop 只提供决策背景，不构成外部动作授权。
6. 模型不能通过输出修改本结构；任何状态变化都必须走对应权威服务。
7. 未传入、被截断、因权限不可见和确实不存在必须保持不同语义。
8. Context Builder 必须在模型调用前完成 Schema 校验和 Secret 扫描。

## 10. 骨架示例

```yaml
schema_version: 1
input_type: consciousness_state_input
snapshot_id: 0199a860-0000-7000-8000-000000000001
generated_at: 2026-09-02T05:20:00Z
as_of: 2026-09-02T05:19:58Z
subject:
  entity_id: 0199a100-0000-7000-8000-000000000001
  entity_type: PERSON
  display_label: Master
trigger:
  type: INTERACTION
  ref: 0199aa00-0000-7000-8000-000000000001
  occurred_at: 2026-09-02T05:19:58Z
  summary: Master 补充了模型输入数据结构要求
live_world_state:
  schema_version: 1
  input_type: live_world_state_input
  states: []
world_model:
  schema_version: 1
  input_type: world_model_input
  facts: []
active_goals: []
open_loops: []
recent_changes: []
budget:
  max_total_tokens: 6000
  reserved_response_tokens: 1500
  sections: {}
coverage:
  truncated: false
  truncated_sections: []
  omitted_counts: {}
  absence_semantics: OMITTED_OR_MISSING_DOES_NOT_MEAN_FALSE
integrity:
  live_world_state_hash: sha256:...
  world_model_hash: sha256:...
  goals_hash: sha256:...
  open_loops_hash: sha256:...
  recent_changes_hash: sha256:...
  payload_hash: sha256:...
  hash_algorithm: sha256
```

骨架示例省略了两个子结构的完整字段。实际调用必须分别满足 `LiveWorldStateInput` 和 `WorldModelInput` 的完整契约，不能使用该骨架替代 Schema 校验。
