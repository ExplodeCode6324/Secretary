# Feedback

短结论与执行引用；主会话读到时详情已保存。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/Feedback)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "Feedback" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `state` | FeedbackState | 是 |  关联：[FeedbackState](FeedbackState.md) |
| `task_id` | ID | 是 |  关联：[ID](ID.md) |
| `execution_id` | ID | 是 |  关联：[ID](ID.md) |
| `kind` | RESULT / DECISION_REQUIRED / PROGRESS / UNKNOWN | 是 |  |
| `summary` | string | 是 |  {"minLength": 1} |
| `detail_ref` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `result_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `decision_request_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `input_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `created_at` | Time | 是 |  关联：[Time](Time.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
