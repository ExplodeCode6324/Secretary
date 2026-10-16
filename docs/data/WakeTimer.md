# WakeTimer

主会话持久定时唤醒；FIRED 与唯一 TIMER Input 同事务提交。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/WakeTimer)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `session_id` | ID | 是 |  关联：[ID](ID.md) |
| `record_type` | "WakeTimer" | 是 |  |
| `at` | Time | 是 |  关联：[Time](Time.md) |
| `note` | string | 是 |  {"minLength": 1, "maxLength": 4096} |
| `source_event_ids` | array<ID> | 是 |  {"minItems": 1} 关联：[ID](ID.md) |
| `state` | PENDING / FIRED / CANCELLED | 是 |  |
| `fired_at` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `cancelled_at` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `input_id` | ID 或 null | 是 |  关联：[ID](ID.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
