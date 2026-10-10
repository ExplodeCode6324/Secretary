# SettingsApplication

固定批次的设置应用；数据库提交后必须完成重建才可继续主会话。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/SettingsApplication)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。字段存在不等于全部语义已实现，行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `record_type` | "SettingsApplication" | 是 |  |
| `session_id` | ID | 是 |  关联：[ID](ID.md) |
| `state` | QUEUED / SUMMARIZING / COMMITTING / REBUILDING / APPLIED / FAILED / BLOCKED | 是 |  |
| `payload_ref` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `source_ref` | ObjectRef 或 null | 是 | SettingsSource 固定来源、完整分片、原记忆、事件截止和精确 World 变更；定义见 settings-memory.ts。 关联：[ObjectRef](ObjectRef.md) |
| `candidate_ref` | ObjectRef 或 null | 是 | SettingsCandidate 的记忆事项、宿主承诺及已完成分片数；仅候选，不提前生效。 关联：[ObjectRef](ObjectRef.md) |
| `error` | ['string', 'null'] | 是 |  |
| `request_id` | ID | 是 |  关联：[ID](ID.md) |
| `request_hash` | Digest | 是 |  关联：[Digest](Digest.md) |
| `context_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `runtime_settings_hash` | Digest | 是 | 本应用绑定的主/任务模型、提示词、数据库身份和运行选项哈希；未完成应用需原配置恢复。 关联：[Digest](Digest.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
