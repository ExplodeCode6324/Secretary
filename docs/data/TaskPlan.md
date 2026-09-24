# TaskPlan

id 即 task_id；先保存计划再建幂等目录，agent 在可执行时由 dispatch 拉起。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/TaskPlan)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "TaskPlan" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `state` | PlanState | 是 |  关联：[PlanState](PlanState.md) |
| `proposal_request_id` | ID | 是 |  关联：[ID](ID.md) |
| `proposal_ref` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `workspace` | RelativePath | 是 |  关联：[RelativePath](RelativePath.md) |
| `trigger` | Trigger | 是 |  关联：[Trigger](Trigger.md) |
| `preconditions` | array<Precondition> | 是 |  {"minItems": 0} 关联：[Precondition](Precondition.md) |
| `executor` | ExecutorSpec | 是 |  关联：[ExecutorSpec](ExecutorSpec.md) |
| `feedback_policy` | FeedbackPolicy | 是 |  关联：[FeedbackPolicy](FeedbackPolicy.md) |
| `next_due_at` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `pending_occurrences` | array<string> | 是 |  {"minItems": 0} |
| `active_execution_ids` | array<ID> | 是 |  {"minItems": 0} 关联：[ID](ID.md) |
| `deadline` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `safety_rule_id` | ID | 是 |  关联：[ID](ID.md) |
| `initialization_error` | string 或 null | 是 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
