# UserInstructions

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/UserInstructions)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `record_type` | "UserInstructions" | 是 |  |
| `content` | string | 是 |  {"maxLength": 2000} |
| `updated_by` | MASTER_UI / DEFAULT | 是 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
