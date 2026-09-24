# MemoryCommitment

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/MemoryCommitment)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `text` | string | 是 |  {"minLength": 1} |
| `state` | OPEN / COMPLETED / CANCELLED | 是 |  |
| `source_refs` | array<ObjectRef> | 是 |  {"minItems": 1} 关联：[ObjectRef](ObjectRef.md) |
| `task_refs` | array<ID> | 是 |  关联：[ID](ID.md) |
| `resolution_event_ids` | array<ID> | 是 |  关联：[ID](ID.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
