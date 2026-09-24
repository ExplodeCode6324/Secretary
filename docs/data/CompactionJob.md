# CompactionJob

固定范围摘要任务；新增输入不纳入覆盖集合。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/CompactionJob)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "CompactionJob" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `state` | CompactionState | 是 |  关联：[CompactionState](CompactionState.md) |
| `session_id` | ID | 是 |  关联：[ID](ID.md) |
| `base_revision` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `source_event_ids` | array<ID> | 是 |  {"minItems": 0} 关联：[ID](ID.md) |
| `source_refs` | array<ObjectRef> | 是 |  {"minItems": 1} 关联：[ObjectRef](ObjectRef.md) |
| `candidate_ref` | ObjectRef 或 null | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `covered_event_ids` | array<ID> | 是 |  {"minItems": 0} 关联：[ID](ID.md) |
| `validation_errors` | array<string> | 是 |  {"minItems": 0} |
| `memory_version` | 2 | 否 |  |
| `attempt` | integer | 否 |  {"minimum": 1, "maximum": 2} |
| `source_end_sequence` | integer | 否 |  {"minimum": 0} |

## 组合约束

```json
{
  "additionalProperties": false
}
```
