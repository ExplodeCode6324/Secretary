# TaskProposal

主会话只提出任务；不接受 authorized、grant 等模型声明。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/TaskProposal)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "TaskProposal" | 是 |  |
| `request_id` | ID | 是 |  关联：[ID](ID.md) |
| `request_hash` | Digest | 是 |  关联：[Digest](Digest.md) |
| `submitted_at` | Time | 是 |  关联：[Time](Time.md) |
| `session_id` | ID | 是 |  关联：[ID](ID.md) |
| `goal` | string | 是 |  {"minLength": 1} |
| `constraints` | array<string> | 是 |  {"minItems": 0} |
| `acceptance_criteria` | array<string> | 是 |  {"minItems": 1} |
| `trigger` | Trigger | 是 |  关联：[Trigger](Trigger.md) |
| `preconditions` | array<Precondition> | 是 |  {"minItems": 0} 关联：[Precondition](Precondition.md) |
| `executor` | ExecutorSpec | 是 |  关联：[ExecutorSpec](ExecutorSpec.md) |
| `feedback_policy` | FeedbackPolicy | 是 |  关联：[FeedbackPolicy](FeedbackPolicy.md) |
| `deadline` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `context_refs` | array<ObjectRef> | 是 |  {"minItems": 0} 关联：[ObjectRef](ObjectRef.md) |
| `parent_execution_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `safety_rule_id` | ID | 是 |  关联：[ID](ID.md) |
| `reuse_task_id` | ID 或 null | 是 | null 创建新计划；非空表示按同目标/约束接续现有计划，须与 parent_execution_id 所属计划一致。 关联：[ID](ID.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
