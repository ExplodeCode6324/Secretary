# cognition.consciousness_snapshot

## 1. 定义

`consciousness_snapshot` 保存特定触发时刻由 Context Builder 选出的实时状态、长期事实、目标、Open Loop 和近期显著变化引用。它用于调试、重放和模型调用审计，是可重建快照，不具备独立事实权威。

权威写入者为 Consciousness Builder。快照创建后不可修改。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `snapshot_id` | `uuid` | 是 | 主键 |
| `subject_entity_id` | `uuid` | 是 | 意识状态主体 |
| `trigger_type` | `text` | 是 | `INTERACTION`、`OBSERVATION`、`TASK_EVENT` 或 `SCHEDULE` |
| `trigger_ref` | `uuid` | 是 | 触发记录标识 |
| `as_of` | `timestamptz` | 是 | 输入数据业务时间水位 |
| `built_at` | `timestamptz` | 是 | 快照完成时间 |
| `builder_version` | `text` | 是 | 选择、排序与截断算法版本 |
| `selection_policy_version` | `text` | 是 | 认知准入策略版本 |
| `live_state_ids` | `uuid[]` | 是 | 选中的 Live World State 版本 |
| `world_fact_ids` | `uuid[]` | 是 | 选中的 World Model Fact 版本 |
| `goal_ids` | `uuid[]` | 是 | 选中的活跃目标 |
| `open_loop_ids` | `uuid[]` | 是 | 选中的未闭环事项 |
| `recent_observation_ids` | `uuid[]` | 是 | 近期显著变化 |
| `model_input_ref` | `text` | 是 | 不可变 `ConsciousnessStateInput` 对象引用 |
| `model_input_hash` | `text` | 是 | 规范化模型输入哈希 |
| `token_estimate` | `integer` | 是 | 非负估算值 |
| `budget` | `jsonb` | 是 | 各输入区段数量或 token 上限 |
| `truncation` | `jsonb` | 是 | 被截断类别、数量和最低保留规则 |
| `expires_at` | `timestamptz` | 否 | 作为当前认知快照的失效时间 |
| `trace_id` | `uuid` | 是 | 跨层追踪标识 |

## 3. 不可变量

1. 快照只保存已选择记录的精确版本标识，不得使用会漂移的 latest 引用。
2. `model_input_hash` 必须覆盖实际传入模型的完整规范化结构。
3. 截断发生时必须记录被截断类别和数量，模型输入不得暗示未选中数据不存在。
4. 过期 Live World State 必须在输入结构中显式标记，不能仅因显著性高而去除新鲜度语义。
5. 模型输出不得反向修改快照。
6. 快照不保存 Secret、长期凭据或未脱敏原始载荷。

## 4. 关系与索引

- 引用 Live World State、World Model Fact、Goal、Open Loop 和 Observation 的不可变版本。
- 触发查询索引：`(trigger_type, trigger_ref)`。
- 主体时间索引：`(subject_entity_id, built_at desc)`。
- 重放校验索引：`model_input_hash`。

## 5. 模型输入边界

实际载荷必须符合 [`ConsciousnessStateInput`](../context/consciousness-state-input.md)，其中的 Live World State 和 World Model 分别符合各自独立输入契约。

## 6. 示例

```yaml
snapshot_id: 0199a860-0000-7000-8000-000000000001
subject_entity_id: 0199a100-0000-7000-8000-000000000001
trigger_type: INTERACTION
trigger_ref: 0199aa00-0000-7000-8000-000000000001
as_of: 2026-09-02T05:10:00Z
built_at: 2026-09-02T05:10:00.080Z
builder_version: consciousness-builder/1.0.0
selection_policy_version: admission-v1
live_state_ids:
  - 0199a810-0000-7000-8000-000000000001
world_fact_ids:
  - 0199a820-0000-7000-8000-000000000001
goal_ids:
  - 0199a830-0000-7000-8000-000000000001
open_loop_ids:
  - 0199a840-0000-7000-8000-000000000001
recent_observation_ids: []
model_input_ref: object://context/0199a860/input.yaml
model_input_hash: sha256:a19c...
token_estimate: 1240
budget:
  max_tokens: 3000
truncation:
  occurred: false
trace_id: 0199a860-0000-7000-8000-000000000099
```
