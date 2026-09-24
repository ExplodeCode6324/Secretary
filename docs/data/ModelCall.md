# ModelCall

模型传输生命周期；完整响应保存后才解析工具请求。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/ModelCall)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "ModelCall" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `state` | CallState | 是 |  关联：[CallState](CallState.md) |
| `context_id` | ID | 是 |  关联：[ID](ID.md) |
| `scope` | Scope | 是 |  关联：[Scope](Scope.md) |
| `transport_attempt` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `request` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `response` | ObjectRef 或 null | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `started_at` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `completed_at` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `error` | string 或 null | 是 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
