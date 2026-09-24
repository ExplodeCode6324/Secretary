# TaskControlCommand

普通任务控制；无 APPROVE 授权操作。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/TaskControlCommand)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "TaskControlCommand" | 是 |  |
| `request_id` | ID | 是 |  关联：[ID](ID.md) |
| `expected_revision` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `action` | PAUSE_PLAN / RESUME_PLAN / CLOSE_PLAN / CANCEL_EXECUTION / ANSWER_DECISION | 是 |  |
| `target_id` | ID | 是 |  关联：[ID](ID.md) |
| `answer` | JSON 或 null | 是 |  |
| `decision_request_id` | ID 或 null | 是 |  关联：[ID](ID.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
