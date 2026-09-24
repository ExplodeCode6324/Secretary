# WorldReadResult

空结果不自动解释为事实不存在；CONTESTED 全部候选可查询。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/WorldReadResult)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "WorldReadResult" | 是 |  |
| `request_id` | ID | 是 |  关联：[ID](ID.md) |
| `facts` | array<WorldFact> | 是 |  {"minItems": 0} 关联：[WorldFact](WorldFact.md) |
| `observed_db_at` | Time | 是 |  关联：[Time](Time.md) |
| `next_cursor` | string 或 null | 是 |  |
| `omitted_count` | integer | 是 |  {"minimum": 0, "maximum": 9007199254740991} |
| `missing_reason` | NOT_FOUND / UNAVAILABLE / FILTERED 或 null | 是 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
