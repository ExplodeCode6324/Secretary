# Consciousness

当前工作记忆；全部摘要提交与原文承接集合一次保存。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/Consciousness)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "Consciousness" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `session_id` | ID | 是 |  关联：[ID](ID.md) |
| `items` | array<WorkItem> | 是 |  {"minItems": 0} 关联：[WorkItem](WorkItem.md) |
| `pending_raw_refs` | array<ObjectRef> | 是 |  {"minItems": 0} 关联：[ObjectRef](ObjectRef.md) |
| `covered_event_ids` | array<ID> | 是 |  {"minItems": 0} 关联：[ID](ID.md) |
| `last_job_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `commitments` | array<MemoryCommitment> | 否 |  关联：[MemoryCommitment](MemoryCommitment.md) |
| `covered_event_sequence` | integer | 否 |  {"minimum": 0} |

## 组合约束

```json
{
  "additionalProperties": false
}
```
