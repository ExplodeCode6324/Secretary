# JournalTransaction

单写事务，frame 原始 payload 字节 checksum 外包；同帧全生效或全不生效。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/JournalTransaction)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "JournalTransaction" | 是 |  |
| `txn_id` | ID | 是 |  关联：[ID](ID.md) |
| `sequence` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `owner_epoch` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `previous_digest` | Digest | 是 |  关联：[Digest](Digest.md) |
| `mutations` | array<Mutation> | 是 |  {"minItems": 0} 关联：[Mutation](Mutation.md) |
| `log_records` | array<OperationLogRecord> | 是 |  {"minItems": 0} 关联：[OperationLogRecord](OperationLogRecord.md) |
| `receipts` | array<CommandReceipt> | 是 |  {"minItems": 0} 关联：[CommandReceipt](CommandReceipt.md) |
| `committed_at` | Time | 是 |  关联：[Time](Time.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
