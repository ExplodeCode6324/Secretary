# CommitmentSourceBatch

宿主绑定的新承诺来源批次；必须与指定持久化 owner 的事件集合和边界完全一致。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/CommitmentSourceBatch)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。字段存在不等于全部语义已实现，行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `owner_type` | CompactionJob / SettingsApplication | 是 |  |
| `owner_id` | ID | 是 |  关联：[ID](ID.md) |
| `source_event_ids` | array<ID> | 是 |  关联：[ID](ID.md) |
| `source_end_sequence` | integer | 是 |  {"minimum": 0, "maximum": 9007199254740991} |

## 组合约束

```json
{
  "additionalProperties": false
}
```
