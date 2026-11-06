# Guidance

Durable exact-execution guidance; independent sent, received and adopted milestones.

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/Guidance)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "Guidance" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `task_id` | ID | 是 |  关联：[ID](ID.md) |
| `execution_id` | ID | 是 |  关联：[ID](ID.md) |
| `session_id` | ID | 是 |  关联：[ID](ID.md) |
| `source` | MASTER / MAIN | 是 |  |
| `source_ref` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `request_id` | ID | 是 |  关联：[ID](ID.md) |
| `request_hash` | Digest | 是 |  关联：[Digest](Digest.md) |
| `text` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `text_bytes` | integer | 是 |  {"minimum": 0, "maximum": 9007199254740991} |
| `sequence` | integer | 是 |  {"minimum": 0, "maximum": 9007199254740991} |
| `sent_at` | Time | 是 |  关联：[Time](Time.md) |
| `received_at` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `guided_at` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `disposition` | PENDING / ADOPTED / CONFLICT / CANNOT_APPLY / UNPROCESSED | 是 |  |
| `receipt_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `closed_reason` | string 或 null | 是 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
