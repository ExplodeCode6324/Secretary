# TaskQuery

DETAIL 成功且 execution 仍 HOT 时刷新留存；LIST 不刷新。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/TaskQuery)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "TaskQuery" | 是 |  |
| `request_id` | ID | 是 |  关联：[ID](ID.md) |
| `kind` | CAPABILITIES / LIST / DETAIL | 是 |  |
| `task_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `execution_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `limit` | integer | 是 |  {"minimum": 1, "maximum": 100} |
| `cursor` | string 或 null | 是 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
