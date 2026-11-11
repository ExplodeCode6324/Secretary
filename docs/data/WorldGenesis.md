# WorldGenesis

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/WorldGenesis)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "WorldGenesis" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 |  {"minimum": 1} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `manifest_ref` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `entity_count` | integer | 是 |  {"minimum": 0} |
| `assertion_count` | integer | 是 |  {"minimum": 0} |
| `mode` | FRESH / LEGACY | 是 |  |
| `owner_id` | ID | 是 |  关联：[ID](ID.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
