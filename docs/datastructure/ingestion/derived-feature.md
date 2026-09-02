# ingestion.derived_feature

## 1. 定义

`derived_feature` 保存 Domain Processor 从一组 Observation 或时序样本计算出的高信息密度特征。它是可重算的派生数据，不具备独立事实权威。

权威写入者为版本化 Domain Processor。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `feature_id` | `uuid` | 是 | 主键 |
| `subject_entity_id` | `uuid` | 是 | 特征所属主体 |
| `feature_type` | `text` | 是 | 稳定特征类型 |
| `value` | `jsonb` | 是 | 类型化特征值 |
| `unit` | `text` | 否 | UCUM 或领域约定单位 |
| `window_start` | `timestamptz` | 是 | 计算窗口起点 |
| `window_end` | `timestamptz` | 是 | 计算窗口终点 |
| `source_observation_ids` | `uuid[]` | 是 | 输入 Observation 标识集合 |
| `source_series_ref` | `text` | 否 | 高频时序输入切片引用 |
| `method_id` | `text` | 是 | 算法或处理器稳定标识 |
| `method_version` | `text` | 是 | 算法版本、模型版本或代码摘要 |
| `parameters_hash` | `text` | 是 | 规范化计算参数哈希 |
| `quality_score` | `numeric(5,4)` | 否 | `[0,1]`，表示数据完备性或算法质量 |
| `computed_at` | `timestamptz` | 是 | 计算完成时间 |
| `valid_until` | `timestamptz` | 否 | 可作为当前输入的截止时间 |
| `supersedes_feature_id` | `uuid` | 否 | 新算法版本或更正关系 |
| `trace_id` | `uuid` | 是 | 跨层追踪标识 |

## 3. 不可变量

1. `window_end` 必须晚于 `window_start`。
2. 相同输入、方法版本和参数必须产生相同的规范化结果或明确记录非确定性来源。
3. 派生特征不得覆盖原始 Observation，也不得作为长期事实唯一证据。
4. 算法升级生成新记录，不原位重写历史结果。
5. `source_observation_ids` 为空时必须提供 `source_series_ref`。

## 4. 关系与索引

- `subject_entity_id -> cognition.entity.entity_id`。
- `source_observation_ids[] -> ingestion.observation.observation_id`。
- 重算唯一键建议为 `(subject_entity_id, feature_type, window_start, window_end, method_id, method_version, parameters_hash)`。
- 状态估计读取索引：`(subject_entity_id, feature_type, window_end desc)`。
- 建议按 `computed_at` 月分区；可依据重算能力设置较短保留期。

## 5. 示例

```yaml
feature_id: 0199a700-0000-7000-8000-000000000001
subject_entity_id: 0199a100-0000-7000-8000-000000000001
feature_type: activity.repository_change_rate
value:
  commits: 4
  files_changed: 19
unit: count
window_start: 2026-09-02T03:00:00Z
window_end: 2026-09-02T04:00:00Z
source_observation_ids:
  - 0199a6f1-0170-7000-8000-000000000001
method_id: project-processor/change-rate
method_version: 1.0.0
parameters_hash: sha256:f123...
computed_at: 2026-09-02T04:00:02Z
trace_id: 0199a700-0000-7000-8000-000000000099
```
