# ingestion.observation

## 1. 定义

`observation` 是时间观察层的规范化事实记录，用于描述在特定时间由何种来源观察到何种现象。外部源事件、Master 输入和动作效果回读均进入这一结构。

Observation 只陈述可追溯的观察结果，不直接宣告长期事实。权威写入者为 Observation Service 或 Verifier Observation Adapter。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `observation_id` | `uuid` | 是 | 主键 |
| `source_event_id` | `uuid` | 否 | 外部接入来源；动作效果回读可为空 |
| `observation_type` | `text` | 是 | 规范化观察类型 |
| `subject_entity_id` | `uuid` | 是 | 被观察主体 |
| `actor_entity_id` | `uuid` | 否 | 行为发起者或可确认的观察参与者 |
| `source_system` | `text` | 是 | 实际观察来源 |
| `event_time` | `timestamptz` | 是 | 被观察现象发生时间 |
| `observed_at` | `timestamptz` | 是 | 观察行为完成时间 |
| `recorded_at` | `timestamptz` | 是 | 记录持久化时间 |
| `valid_from` | `timestamptz` | 否 | 观察值适用区间起点 |
| `valid_to` | `timestamptz` | 否 | 观察值适用区间终点，开区间可为空 |
| `value` | `jsonb` | 是 | 符合 `observation_type` Schema 的规范化值 |
| `value_schema_version` | `integer` | 是 | 值 Schema 版本 |
| `quality` | `text` | 是 | `DIRECT`、`NORMALIZED`、`ESTIMATED` 或 `PARTIAL` |
| `evidence_refs` | `uuid[]` | 是 | 证据索引标识，默认空数组 |
| `action_id` | `uuid` | 否 | 产生被观察效果的动作 |
| `action_attempt_id` | `uuid` | 否 | 对应执行尝试 |
| `supersedes_observation_id` | `uuid` | 否 | 更正关系；不得删除原记录 |
| `trace_id` | `uuid` | 是 | 跨层追踪标识 |
| `created_by` | `text` | 是 | Observation Adapter 或 Verifier 的稳定组件标识 |

## 3. 不可变量

1. Observation 为追加式记录。更正、撤回和补充均通过新记录表达。
2. `valid_to` 非空时必须晚于 `valid_from`。
3. `quality=ESTIMATED` 的记录不得被外部回执验证流程当作直接证据。
4. 动作效果观察必须关联 `action_id`、`action_attempt_id` 和至少一项证据。
5. Observation 不直接更新 `world_model_fact`。State Estimation 或 World Model Updater 必须执行独立准入。
6. 模型辅助识别结果必须标记来源和质量，不得伪装为传感器或外部 API 直接观察。

## 4. 关系与索引

- `source_event_id -> ingestion.source_event.source_event_id`。
- `evidence_refs[] -> ingestion.evidence_index.evidence_id`。
- `subject_entity_id` 和 `actor_entity_id -> cognition.entity.entity_id`。
- `action_id -> execution.action.action_id`。
- `action_attempt_id -> execution.action_attempt.attempt_id`。
- 来源重放索引：`(source_event_id, observation_type)`。
- 主体时间索引：`(subject_entity_id, observation_type, event_time desc)`。
- 效果对账索引：`(action_id, action_attempt_id)`。
- 建议按 `recorded_at` 月分区。

## 5. 示例

```yaml
observation_id: 0199a6f1-0170-7000-8000-000000000001
observation_type: repository.commit_observed
subject_entity_id: 0199a100-0000-7000-8000-000000000010
source_system: git
event_time: 2026-09-02T04:18:12Z
observed_at: 2026-09-02T04:18:13Z
recorded_at: 2026-09-02T04:18:13.040Z
value:
  branch: main
  commit_sha: 0c4cdf7e76b25c7cd7316844def3af8d7d3c6e5b
value_schema_version: 1
quality: DIRECT
evidence_refs: []
trace_id: 0199a6f0-6ef0-7000-8000-000000000099
created_by: git-observation-adapter/v1
```
