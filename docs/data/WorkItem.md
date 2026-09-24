# WorkItem

事项不等于任务；未履行且无人承接的事项不退出。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/WorkItem)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `item_id` | ID | 是 |  关联：[ID](ID.md) |
| `tier` | ACTIVE / QUIET / MINIMAL | 是 |  |
| `summary` | string | 是 |  {"minLength": 1} |
| `goals` | array<string> | 是 |  {"minItems": 0} |
| `constraints` | array<string> | 是 |  {"minItems": 0} |
| `decisions` | array<string> | 是 |  {"minItems": 0} |
| `open_questions` | array<string> | 是 |  {"minItems": 0} |
| `unfulfilled_commitments` | array<string> | 是 |  {"minItems": 0} |
| `task_refs` | array<ID> | 是 |  {"minItems": 0} 关联：[ID](ID.md) |
| `source_refs` | array<ObjectRef> | 是 |  {"minItems": 1} 关联：[ObjectRef](ObjectRef.md) |
| `last_activity_at` | Time | 是 |  关联：[Time](Time.md) |
| `pending_owner` | MAIN / SCHEDULER 或 null | 是 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
