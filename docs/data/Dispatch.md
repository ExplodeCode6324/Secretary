# Dispatch

Scheduler -> worker 固定分派；重复 attempt_id 返回既有回执，不重新起进程。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/Dispatch)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "Dispatch" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `task_id` | ID | 是 |  关联：[ID](ID.md) |
| `execution_id` | ID | 是 |  关联：[ID](ID.md) |
| `attempt_id` | ID | 是 |  关联：[ID](ID.md) |
| `owner_epoch` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `plan_revision` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `executor` | ExecutorSpec | 是 |  关联：[ExecutorSpec](ExecutorSpec.md) |
| `workspace` | RelativePath | 是 |  关联：[RelativePath](RelativePath.md) |
| `resume_checkpoint_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `operation_ids` | array<ID> | 是 |  {"minItems": 0} 关联：[ID](ID.md) |
| `issued_at` | Time | 是 |  关联：[Time](Time.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
