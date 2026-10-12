# MemoryExtractionJob

冻结的承诺提取来源与有界维护重试；独立于摘要覆盖水位。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/MemoryExtractionJob)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `record_type` | "MemoryExtractionJob" | 是 |  |
| `session_id` | ID | 是 |  关联：[ID](ID.md) |
| `source_keys` | array<Digest> | 是 |  关联：[Digest](Digest.md) |
| `source_event_ids` | array<ID> | 是 |  关联：[ID](ID.md) |
| `source_end_sequence` | integer | 是 |  {"minimum": 0, "maximum": 9007199254740991} |
| `source_ref` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `evidence_ref` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `existing_ref` | ObjectRef 或 null | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `candidate_ref` | ObjectRef 或 null | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `state` | QUEUED / RUNNING / SUCCEEDED / FAILED | 是 |  |
| `merged` | boolean | 是 |  |
| `round` | integer | 是 |  {"minimum": 0, "maximum": 3} |
| `generation` | integer | 是 |  {"minimum": 0, "maximum": 9007199254740991} |
| `next_attempt_at` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `error` | ['string', 'null'] | 是 |  |
| `quotes` | array<string> | 是 |  |
| `call_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `owner_id` | ID | 否 |  关联：[ID](ID.md) |
| `progress_ref` | ObjectRef | 否 |  关联：[ObjectRef](ObjectRef.md) |
| `task_refs` | array<ID> | 否 |  关联：[ID](ID.md) |
| `policy_id` | string | 否 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
