# InputCoverageSnapshot

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/InputCoverageSnapshot)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `version` | 1 | 是 |  |
| `session_id` | ID | 是 |  关联：[ID](ID.md) |
| `journal_sequence` | integer | 是 |  {"minimum": 0} |
| `journal_digest` | Digest | 是 |  关联：[Digest](Digest.md) |
| `settings_application_id` | ID | 否 |  关联：[ID](ID.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
