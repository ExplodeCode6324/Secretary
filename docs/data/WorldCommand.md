# WorldCommand

跨 JSON journal / PG 的桥接状态；PG commit receipt 才证明已写。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/WorldCommand)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "WorldCommand" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `state` | WorldCommandState | 是 |  关联：[WorldCommandState](WorldCommandState.md) |
| `change` | WorldChange 或 WorldCatalogChange | 是 |  关联：[WorldCatalogChange](WorldCatalogChange.md), [WorldChange](WorldChange.md) |
| `operation_id` | ID | 是 |  关联：[ID](ID.md) |
| `receipt_ref` | ObjectRef 或 null | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `error` | string 或 null | 是 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
