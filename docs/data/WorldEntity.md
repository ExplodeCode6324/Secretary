# WorldEntity

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/WorldEntity)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "WorldEntity" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 |  {"minimum": 1} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `kind` | PERSON / ORGANIZATION / DEVICE / SERVICE / RESOURCE / PROJECT / GOAL | 是 |  |
| `display_name` | string | 是 |  {"minLength": 1, "maxLength": 256} |
| `aliases` | array<string> | 是 |  {"maxItems": 32} |
| `role` | MASTER / SECRETARY / None | 是 |  |
| `external_key` | string 或 null | 是 |  |
| `retired_at` | Time 或 null | 是 |  关联：[Time](Time.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
