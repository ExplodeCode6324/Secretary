# WorldQuery

memory_read 的 World Model 查询分支；游标绑定筛选与快照。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/WorldQuery)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "WorldQuery" | 是 |  |
| `request_id` | ID | 是 |  关联：[ID](ID.md) |
| `subject_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `predicate_key` | string 或 null | 是 |  |
| `as_of` | Time | 是 |  关联：[Time](Time.md) |
| `include_history` | boolean | 是 |  |
| `limit` | integer | 是 |  {"minimum": 1, "maximum": 100} |
| `cursor` | string 或 null | 是 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
