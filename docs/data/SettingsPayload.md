# SettingsPayload

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/SettingsPayload)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `instructions` | object 或 null | 是 |  |
| `edits` | array<WorldEdit> | 是 |  {"maxItems": 50} 关联：[WorldEdit](WorldEdit.md) |
| `command_ids` | array<ID> | 是 |  {"maxItems": 50} 关联：[ID](ID.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
