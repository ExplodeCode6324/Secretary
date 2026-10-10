# MemoryCommitment

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/MemoryCommitment)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。字段存在不等于全部语义已实现，行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `text` | string | 是 |  {"minLength": 1} |
| `state` | OPEN / COMPLETED / CANCELLED | 是 |  |
| `source_refs` | array<ObjectRef> | 是 |  {"minItems": 1} 关联：[ObjectRef](ObjectRef.md) |
| `task_refs` | array<ID> | 是 |  关联：[ID](ID.md) |
| `resolution_event_ids` | array<ID> | 是 |  关联：[ID](ID.md) |
| `source_batch` | CommitmentSourceBatch | 否 | 新提取承诺的固定事件批次；缺省只按旧 Context 来源兼容，不能凭相同 blob 推断事件归属。 关联：[CommitmentSourceBatch](CommitmentSourceBatch.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
