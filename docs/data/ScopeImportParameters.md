# ScopeImportParameters

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/ScopeImportParameters)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `version` | 1 | 是 |  |
| `request` | ScopeImportProposal | 是 |  关联：[ScopeImportProposal](ScopeImportProposal.md) |
| `proposal` | object | 是 |  {"additionalProperties": false} |
| `source_event_ids` | array<string> | 是 |  {"minItems": 1, "maxItems": 20} |
| `loop_id` | string | 是 |  {"format": "uuid"} |

## 组合约束

```json
{
  "additionalProperties": false
}
```
