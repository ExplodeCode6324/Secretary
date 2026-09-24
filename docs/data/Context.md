# Context

一次调用不可变快照；estimated+reserve<=budget 由业务检查。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/Context)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "Context" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `session_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `execution_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `loop_id` | ID | 是 |  关联：[ID](ID.md) |
| `call_id` | ID | 是 |  关联：[ID](ID.md) |
| `purpose` | MAIN / TASK / COMPACTION | 是 |  |
| `messages` | array<Message> | 是 |  {"minItems": 1} 关联：[Message](Message.md) |
| `raw_context` | ObjectRef | 是 | 原始、可原封不动复载的 context；provider profile 在外部绑定。 关联：[ObjectRef](ObjectRef.md) |
| `provider_profile` | string | 是 |  {"minLength": 1} |
| `adapter_version` | string | 是 |  {"minLength": 1} |
| `tools_schema` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `consciousness_revision` | integer 或 null | 是 |  |
| `input_ids` | array<ID> | 是 |  {"minItems": 0} 关联：[ID](ID.md) |
| `pending_tool_call_ids` | array<string> | 是 |  {"minItems": 0} |
| `token_budget` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `estimated_tokens` | integer | 是 |  {"minimum": 0, "maximum": 9007199254740991} |
| `reserve_tokens` | integer | 是 |  {"minimum": 0, "maximum": 9007199254740991} |
| `omitted_refs` | array<ObjectRef> | 是 |  {"minItems": 0} 关联：[ObjectRef](ObjectRef.md) |
| `wm_fact_versions` | array<string> | 是 |  {"minItems": 0} |
| `capture_kind` | CHECKPOINT / MODEL_REQUEST | 否 |  |
| `base_prompt_version` | string | 否 |  |
| `instructions_revision` | integer | 否 |  {"minimum": 0} |
| `system_prompt_hash` | Digest | 否 |  关联：[Digest](Digest.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
