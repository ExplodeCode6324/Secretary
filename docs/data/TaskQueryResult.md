# TaskQueryResult

RETIRED 不复活旧执行，返回历史引用。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/TaskQueryResult)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "TaskQueryResult" | 是 |  |
| `request_id` | ID | 是 |  关联：[ID](ID.md) |
| `plans` | array<TaskPlan> | 是 |  {"minItems": 0} 关联：[TaskPlan](TaskPlan.md) |
| `executions` | array<Execution> | 是 |  {"minItems": 0} 关联：[Execution](Execution.md) |
| `results` | array<TaskResult> | 是 |  {"minItems": 0} 关联：[TaskResult](TaskResult.md) |
| `programs` | array<ProgramRegistration> | 是 |  {"minItems": 0} 关联：[ProgramRegistration](ProgramRegistration.md) |
| `next_cursor` | string 或 null | 是 |  |
| `historical_refs` | array<ObjectRef> | 是 |  {"minItems": 0} 关联：[ObjectRef](ObjectRef.md) |
| `unavailable_reason` | NOT_FOUND / RETIRED / UNAVAILABLE 或 null | 是 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
