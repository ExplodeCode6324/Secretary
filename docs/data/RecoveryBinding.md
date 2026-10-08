# RecoveryBinding

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/RecoveryBinding)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `authorization_id` | ID | 否 | Server-issued in-memory authorization; required for new consumption, optional only for legacy receipt compatibility. 关联：[ID](ID.md) |
| `issued_at` | Time | 否 | Server-issued ticket time; cannot be extended by the caller. 关联：[Time](Time.md) |
| `expires_at` | Time | 否 | Five-minute first-consumption deadline. Consumed same-request receipts remain replayable after expiry or restart. 关联：[Time](Time.md) |
| `group_key` | Digest | 是 |  关联：[Digest](Digest.md) |
| `attempt_id` | ID | 是 |  关联：[ID](ID.md) |
| `expected_revision` | integer | 是 |  {"minimum": 1} |
| `policy` | string | 是 |  {"minLength": 1} |
| `implementation_version` | string | 是 |  {"minLength": 1} |
| `config_hash` | Digest | 是 |  关联：[Digest](Digest.md) |
| `source_hash` | Digest | 是 |  关联：[Digest](Digest.md) |
| `model_call_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `model_request_hash` | Digest 或 null | 是 |  关联：[Digest](Digest.md) |
| `actual_payload_hash` | Digest 或 null | 是 |  关联：[Digest](Digest.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
