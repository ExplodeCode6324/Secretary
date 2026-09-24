# Input

外部输入；工具返回不创建此对象。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/Input)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "Input" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `session_id` | ID | 是 |  关联：[ID](ID.md) |
| `dedupe_key` | string | 是 | producer 内稳定键 {"minLength": 1} |
| `producer` | MASTER / SCHEDULER / ENVIRONMENT | 是 |  |
| `state` | InputState | 是 |  关联：[InputState](InputState.md) |
| `payload` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `loop_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `received_at` | Time | 是 |  关联：[Time](Time.md) |
| `feedback_id` | ID 或 null | 是 |  关联：[ID](ID.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
