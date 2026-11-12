# ScopeImportProposal

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/ScopeImportProposal)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `name` | string | 是 |  {"minLength": 1, "maxLength": 256} |
| `description` | string | 否 |  {"maxLength": 4000} |
| `kind` | NONE / DIRECTORY | 是 |  |
| `root_path` | ['string', 'null'] | 否 |  {"maxLength": 4096} |
| `notes_path` | ['string', 'null'] | 否 |  {"maxLength": 4096} |
| `default_write` | allow / ask | 否 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
