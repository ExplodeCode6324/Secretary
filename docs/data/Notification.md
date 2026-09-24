# Notification

主会话普通通知；独立于授权 UI 展示。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/Notification)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "Notification" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `state` | NotificationState | 是 |  关联：[NotificationState](NotificationState.md) |
| `session_id` | ID | 是 |  关联：[ID](ID.md) |
| `channel` | string | 是 |  {"minLength": 1} |
| `message` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `delivery_key` | ID | 是 |  关联：[ID](ID.md) |
| `receipt` | ObjectRef 或 null | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `requested_at` | Time | 是 |  关联：[Time](Time.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
