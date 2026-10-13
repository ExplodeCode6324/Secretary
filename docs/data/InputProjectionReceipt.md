# InputProjectionReceipt

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/InputProjectionReceipt)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `version` | 1 | 是 |  |
| `session_id` | ID | 是 |  关联：[ID](ID.md) |
| `policy_id` | Digest | 是 |  关联：[Digest](Digest.md) |
| `considered_journal_sequence` | integer | 是 |  {"minimum": 0} |
| `coverage_ref` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `window_input_ids` | array<ID> | 是 |  {"maxItems": 100} 关联：[ID](ID.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
