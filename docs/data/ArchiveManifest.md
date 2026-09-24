# ArchiveManifest

退出 Scheduler 前完整性检查；归档不删除长期历史。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/ArchiveManifest)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "ArchiveManifest" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `task_id` | ID | 是 |  关联：[ID](ID.md) |
| `execution_id` | ID | 是 |  关联：[ID](ID.md) |
| `log_event_ids` | array<ID> | 是 |  {"minItems": 0} 关联：[ID](ID.md) |
| `objects` | array<ObjectRef> | 是 |  {"minItems": 1} 关联：[ObjectRef](ObjectRef.md) |
| `verified_at` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `retired_at` | Time 或 null | 是 |  关联：[Time](Time.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
