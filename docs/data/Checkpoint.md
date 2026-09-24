# Checkpoint

宿主保存原 context + 接续说明；恢复不执行历史工具。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/Checkpoint)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "Checkpoint" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `task_id` | ID | 是 |  关联：[ID](ID.md) |
| `execution_id` | ID | 是 |  关联：[ID](ID.md) |
| `executor_kind` | AGENT / PROGRAM | 是 |  |
| `context_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `raw_context` | ObjectRef 或 null | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `program_resume_ref` | ObjectRef 或 null | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `continuation` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `artifact_refs` | array<ObjectRef> | 是 |  {"minItems": 0} 关联：[ObjectRef](ObjectRef.md) |
| `completed_operation_ids` | array<ID> | 是 |  {"minItems": 0} 关联：[ID](ID.md) |
| `pending_operation_ids` | array<ID> | 是 |  {"minItems": 0} 关联：[ID](ID.md) |
| `pending_tool_call_ids` | array<string> | 是 |  {"minItems": 0} |
| `adapter_version` | string | 是 |  {"minLength": 1} |
| `provider_profile` | string | 是 |  {"minLength": 1} |

## 组合约束

```json
{
  "additionalProperties": false
}
```
