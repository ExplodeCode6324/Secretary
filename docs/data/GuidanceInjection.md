# GuidanceInjection

Host-only injection provenance. A queued message is not reception or model consumption.

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/GuidanceInjection)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "GuidanceInjection" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `execution_id` | ID | 是 |  关联：[ID](ID.md) |
| `guidance_ids` | array<ID> | 是 |  {"maxItems": 64} 关联：[ID](ID.md) |
| `attempt_id` | ID | 是 |  关联：[ID](ID.md) |
| `message` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `message_hash` | Digest | 是 |  关联：[Digest](Digest.md) |
| `message_index` | integer 或 null | 是 |  |
| `checkpoint_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `received_at` | Time 或 null | 是 |  关联：[Time](Time.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
