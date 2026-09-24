# Execution

执行生命周期与短期留存是独立维度；终结历史不可回到 RUNNING。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/Execution)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "Execution" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `task_id` | ID | 是 |  关联：[ID](ID.md) |
| `state` | ExecutionState | 是 |  关联：[ExecutionState](ExecutionState.md) |
| `retention_state` | RetentionState | 是 |  关联：[RetentionState](RetentionState.md) |
| `occurrence_key` | string | 是 | task_id+trigger occurrence 唯一 {"minLength": 1} |
| `plan_revision` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `attempt_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `owner_epoch` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `waiting_request_ids` | array<ID> | 是 |  {"minItems": 0} 关联：[ID](ID.md) |
| `condition_results` | array<ConditionResult> | 是 |  {"minItems": 0} 关联：[ConditionResult](ConditionResult.md) |
| `continuation_of` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `pending_followup_ids` | array<ID> | 是 |  {"minItems": 0} 关联：[ID](ID.md) |
| `cancel_requested` | boolean | 是 |  |
| `started_at` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `ended_at` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `last_activity_at` | Time | 是 |  关联：[Time](Time.md) |
| `retire_after_seconds` | integer | 是 | 初始候选 172800，可配置；只限终结且无待处理。 {"minimum": 1, "maximum": 9007199254740991} |
| `result_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `checkpoint_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `unknown_operation_ids` | array<ID> | 是 |  {"minItems": 0} 关联：[ID](ID.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
