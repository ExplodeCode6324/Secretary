# SettingsPayload

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/SettingsPayload)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。字段存在不等于全部语义已实现，行为以调用模块为准。

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
