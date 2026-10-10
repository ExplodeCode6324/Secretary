# Session

逻辑主会话；状态变化由宿主单写，进程停止仍保留。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/Session)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。字段存在不等于全部语义已实现，行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "Session" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `state` | HostState | 是 |  关联：[HostState](HostState.md) |
| `owner_epoch` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `active_loop_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `claimed_input_ids` | array<ID> | 是 |  {"minItems": 0} 关联：[ID](ID.md) |
| `last_context_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `consciousness_id` | ID | 是 |  关联：[ID](ID.md) |
| `last_journal_seq` | integer | 是 |  {"minimum": 0, "maximum": 9007199254740991} |
| `recovery_error` | string 或 null | 是 |  |
| `runtime_settings_hash` | Digest | 否 |  关联：[Digest](Digest.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
