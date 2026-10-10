# NotificationDelivery

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/NotificationDelivery)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。字段存在不等于全部语义已实现，行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "NotificationDelivery" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 |  {"minimum": 1} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `notification_id` | ID | 是 |  关联：[ID](ID.md) |
| `client_id` | ID | 是 |  关联：[ID](ID.md) |
| `session_id` | ID | 是 |  关联：[ID](ID.md) |
| `content_version` | Digest | 是 |  关联：[Digest](Digest.md) |
| `created_at` | Time | 是 |  关联：[Time](Time.md) |
| `received_at` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `presented_at` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `read_at` | Time 或 null | 是 |  关联：[Time](Time.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
