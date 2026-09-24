# CommandReceipt

入口幂等回执；同 request_id 不同 hash 返回冲突。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/CommandReceipt)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "CommandReceipt" | 是 |  |
| `request_id` | ID | 是 |  关联：[ID](ID.md) |
| `request_hash` | Digest | 是 |  关联：[Digest](Digest.md) |
| `status` | ACCEPTED / REJECTED | 是 |  |
| `object_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `reason` | string 或 null | 是 |  |
| `journal_seq` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |

## 组合约束

```json
{
  "additionalProperties": false
}
```
