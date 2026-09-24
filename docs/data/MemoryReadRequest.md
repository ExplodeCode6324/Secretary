# MemoryReadRequest

MemoryUtil 统一读入口；WORLD 需 world_query，其余分支必须为空。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/MemoryReadRequest)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "MemoryReadRequest" | 是 |  |
| `request_id` | ID | 是 |  关联：[ID](ID.md) |
| `source` | WORLD / CONSCIOUSNESS / OPERATION_LOG | 是 |  |
| `world_query` | WorldQuery 或 null | 是 |  关联：[WorldQuery](WorldQuery.md) |
| `item_ids` | array<ID> | 是 |  {"minItems": 0} 关联：[ID](ID.md) |
| `event_ids` | array<ID> | 是 |  {"minItems": 0} 关联：[ID](ID.md) |
| `object_refs` | array<ObjectRef> | 是 |  {"minItems": 0} 关联：[ObjectRef](ObjectRef.md) |
| `limit` | integer | 是 |  {"minimum": 1, "maximum": 100} |
| `cursor` | string 或 null | 是 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
