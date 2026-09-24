# OperationLogRecord

逻辑原始日志；MAIN/TASK 并列，不替代任务查询状态。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/OperationLogRecord)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "OperationLogRecord" | 是 |  |
| `event_id` | ID | 是 |  关联：[ID](ID.md) |
| `stream` | MAIN / TASK / SYSTEM | 是 |  |
| `scope` | Scope | 是 |  关联：[Scope](Scope.md) |
| `sequence` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `event_type` | string | 是 | 事件注册表命名；如 input.accepted / tool.result / authorization.approved。 {"minLength": 1} |
| `occurred_at` | Time | 是 |  关联：[Time](Time.md) |
| `recorded_at` | Time | 是 |  关联：[Time](Time.md) |
| `actor` | MASTER_UI / MAIN / EXECUTOR / SCHEDULER / HOST / PROGRAM | 是 |  |
| `payload` | ObjectRef | 是 | 原始完整内容；敏感 credential 本体不作提示材料。 关联：[ObjectRef](ObjectRef.md) |
| `causation_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `correlation_id` | ID | 是 |  关联：[ID](ID.md) |
| `related_object_ids` | array<ID> | 是 |  {"minItems": 0} 关联：[ID](ID.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
