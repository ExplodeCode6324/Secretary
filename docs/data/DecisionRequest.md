# DecisionRequest

普通决定通过 TaskControl；授权走独立接口。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/DecisionRequest)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "DecisionRequest" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `state` | DecisionState | 是 |  关联：[DecisionState](DecisionState.md) |
| `task_id` | ID | 是 |  关联：[ID](ID.md) |
| `execution_id` | ID | 是 |  关联：[ID](ID.md) |
| `question` | string | 是 |  {"minLength": 1} |
| `options` | array<string> | 是 |  {"minItems": 0} |
| `impact` | string | 是 |  {"minLength": 1} |
| `materials` | array<ObjectRef> | 是 |  {"minItems": 0} 关联：[ObjectRef](ObjectRef.md) |
| `deadline` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `answer` | JSON 或 null | 是 |  |
| `answered_by` | MAIN / MASTER 或 null | 是 |  |
| `answer_request_id` | ID 或 null | 是 |  关联：[ID](ID.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
