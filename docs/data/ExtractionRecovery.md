# ExtractionRecovery

历史提取恢复记录，仅保留读取旧 journal；生产路径不再创建。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/ExtractionRecovery)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "ExtractionRecovery" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 |  {"minimum": 1} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `session_id` | ID | 是 |  关联：[ID](ID.md) |
| `group_key` | Digest | 是 |  关联：[Digest](Digest.md) |
| `attempt_id` | ID | 是 |  关联：[ID](ID.md) |
| `parent_attempt_id` | ID | 是 |  关联：[ID](ID.md) |
| `request_id` | ID | 是 |  关联：[ID](ID.md) |
| `request_hash` | Digest | 是 |  关联：[Digest](Digest.md) |
| `binding_ref` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `generation` | integer | 是 |  {"minimum": 1} |
| `owner_epoch` | integer | 是 |  {"minimum": 1} |
| `state` | CLAIMED / SUCCEEDED / FAILED / BLOCKED | 是 |  |
| `call_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `quotes` | array<string> | 是 |  |
| `error` | ['string', 'null'] | 是 |  |
| `binding_snapshot` | RecoveryBinding | 是 |  关联：[RecoveryBinding](RecoveryBinding.md) |
| `request_snapshot` | RecoveryRequest | 是 |  关联：[RecoveryRequest](RecoveryRequest.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
