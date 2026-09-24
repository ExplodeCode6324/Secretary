# TaskResult

完整结果先可查询，再反馈简要结论；PARTIAL/UNKNOWN 不意味着执行已结束。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/TaskResult)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "TaskResult" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `task_id` | ID | 是 |  关联：[ID](ID.md) |
| `execution_id` | ID | 是 |  关联：[ID](ID.md) |
| `outcome` | SUCCEEDED / FAILED / CANCELLED / EXPIRED / PARTIAL / UNKNOWN | 是 |  |
| `summary` | string | 是 |  {"minLength": 1} |
| `limitations` | array<string> | 是 |  {"minItems": 0} |
| `evidence` | array<ObjectRef> | 是 |  {"minItems": 1} 关联：[ObjectRef](ObjectRef.md) |
| `artifacts` | array<Artifact> | 是 |  {"minItems": 0} 关联：[Artifact](Artifact.md) |
| `detail_ref` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `needs_action` | boolean | 是 |  |
| `verified_by` | PROGRAM_CHECK / MAIN_REVIEW / NOT_VERIFIED | 是 |  |
| `observed_at` | Time | 是 |  关联：[Time](Time.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
