# MainPromptSnapshot

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/MainPromptSnapshot)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。字段存在不等于全部语义已实现，行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `record_type` | "MainPromptSnapshot" | 是 |  |
| `session_id` | ID | 是 |  关联：[ID](ID.md) |
| `base_prompt_version` | string | 是 |  |
| `instructions_revision` | integer | 是 |  {"minimum": 0} |
| `system_prompt_hash` | Digest | 是 |  关联：[Digest](Digest.md) |
| `system_message` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `settings_application_id` | ID 或 null | 否 |  关联：[ID](ID.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
