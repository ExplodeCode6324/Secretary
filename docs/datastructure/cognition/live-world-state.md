# cognition.live_world_state

## 1. 定义

`live_world_state` 保存 State Estimation Service 当前承认的实时状态版本。它面向正在发生或短期有效的状态，例如位置、活动、设备状态和当前项目，不承载稳定长期事实。

权威写入者为 State Estimation Service。Executor、LLM 和普通 Worker 不得直接写入。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `state_id` | `uuid` | 是 | 状态版本主键 |
| `subject_entity_id` | `uuid` | 是 | 状态所属实体 |
| `state_key` | `text` | 是 | 版本化状态键，例如 `activity.current_project` |
| `state_value` | `jsonb` | 是 | 符合状态键 Schema 的值 |
| `value_schema_version` | `integer` | 是 | 状态值 Schema 版本 |
| `unit` | `text` | 否 | 数值状态的标准单位 |
| `status` | `text` | 是 | `CURRENT`、`STALE`、`SUPERSEDED` 或 `RETRACTED` |
| `confidence` | `numeric(5,4)` | 是 | `[0,1]`，估计置信度 |
| `valid_from` | `timestamptz` | 是 | 状态业务有效期起点 |
| `valid_to` | `timestamptz` | 否 | 有效期终点；当前开放区间可为空 |
| `as_of` | `timestamptz` | 是 | 估计器已纳入输入的业务时间水位 |
| `stale_after` | `timestamptz` | 否 | 超过该时间后不得无标记地作为当前状态使用 |
| `source_observation_ids` | `uuid[]` | 是 | 主要 Observation 溯源 |
| `source_feature_ids` | `uuid[]` | 是 | 主要 Derived Feature 溯源 |
| `evidence_refs` | `uuid[]` | 是 | 关键证据引用 |
| `estimator_id` | `text` | 是 | 状态估计器标识 |
| `estimator_version` | `text` | 是 | 状态估计器版本 |
| `supersedes_state_id` | `uuid` | 否 | 上一状态版本 |
| `version` | `bigint` | 是 | 同一状态键的单调版本号 |
| `created_at` | `timestamptz` | 是 | 记录创建时间 |

## 3. 不可变量

1. 同一 `(subject_entity_id, state_key)` 最多存在一个开放区间的 `CURRENT` 版本。
2. 新状态必须引用输入 Observation 或 Derived Feature，不允许无来源写入。
3. 新版本不得物理覆盖旧版本。旧版本转为 `SUPERSEDED` 并关闭有效区间。
4. 达到 `stale_after` 后，模型输入必须显式标记过期，不得把陈旧值伪装为当前事实。
5. `as_of` 不能晚于估计器已处理的输入水位。
6. 实时变化不得直接覆盖 `world_model_fact`。

## 4. 关系与索引

- `subject_entity_id -> cognition.entity.entity_id`。
- 溯源引用 Observation、Derived Feature 和 Evidence Index。
- 当前查询唯一约束：同一主体和状态键仅一个 `status=CURRENT` 的开放区间。
- 当前状态索引：`(subject_entity_id, state_key, status)`。
- 新鲜度索引：`(status, stale_after)`。
- 历史查询索引：`(subject_entity_id, state_key, valid_from desc)`。

## 5. 模型输入边界

本表不能直接整表传入模型。Context Builder 必须按 [`LiveWorldStateInput`](../context/live-world-state-input.md) 生成只读、有界、带新鲜度和溯源的投影。

## 6. 示例

```yaml
state_id: 0199a810-0000-7000-8000-000000000001
subject_entity_id: 0199a100-0000-7000-8000-000000000010
state_key: project.current_branch
state_value:
  branch: main
value_schema_version: 1
status: CURRENT
confidence: 1.0
valid_from: 2026-09-02T04:18:12Z
as_of: 2026-09-02T04:18:12Z
stale_after: 2026-09-02T05:18:12Z
source_observation_ids:
  - 0199a6f1-0170-7000-8000-000000000001
source_feature_ids: []
evidence_refs:
  - 0199a710-0000-7000-8000-000000000001
estimator_id: project-state-estimator
estimator_version: 1.0.0
version: 1
created_at: 2026-09-02T04:18:14Z
```
