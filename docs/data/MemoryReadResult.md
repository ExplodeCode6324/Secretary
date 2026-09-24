# MemoryReadResult

读取只读，不更改 authority 或引发异步新输入。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/MemoryReadResult)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "MemoryReadResult" | 是 |  |
| `request_id` | ID | 是 |  关联：[ID](ID.md) |
| `source` | WORLD / CONSCIOUSNESS / OPERATION_LOG | 是 |  |
| `world_result` | WorldReadResult 或 null | 是 |  关联：[WorldReadResult](WorldReadResult.md) |
| `items` | array<WorkItem> | 是 |  {"minItems": 0} 关联：[WorkItem](WorkItem.md) |
| `records` | array<OperationLogRecord> | 是 |  {"minItems": 0} 关联：[OperationLogRecord](OperationLogRecord.md) |
| `next_cursor` | string 或 null | 是 |  |
| `omitted_count` | integer | 是 |  {"minimum": 0, "maximum": 9007199254740991} |
| `missing_reason` | NOT_FOUND / UNAVAILABLE / FILTERED 或 null | 是 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
