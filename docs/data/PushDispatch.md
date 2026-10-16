# PushDispatch

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/PushDispatch)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `record_type` | "PushDispatch" | 是 |  |
| `target_id` | ID | 是 |  关联：[ID](ID.md) |
| `generation` | ID | 是 |  关联：[ID](ID.md) |
| `notification_id` | ID | 是 |  关联：[ID](ID.md) |
| `state` | PENDING / SENDING / DISPATCHED / FAILED / CANCELLED | 是 |  |
| `batch_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `attempts` | integer | 是 |  {"minimum": 0, "maximum": 4} |
| `attempt_history` | array<object> | 是 |  {"maxItems": 4} 关联：[ID](ID.md), [Time](Time.md) |
| `next_attempt_at` | Time | 是 |  关联：[Time](Time.md) |
| `dispatched_at` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `error_code` | SECRET_UNAVAILABLE / PROVIDER_REJECTED / TRANSPORT_FAILED / UNSUPPORTED_PLATFORM / CONTENT_UNAVAILABLE / INTERRUPTED 或 null | 是 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
