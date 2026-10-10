# UserInstructions

当前有效的 Master 说明；UI 先保存草稿，完整摘要并重建 context 后与应用状态一次提交。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/UserInstructions)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。字段存在不等于全部语义已实现，行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `record_type` | "UserInstructions" | 是 |  |
| `content` | string | 是 |  {"maxLength": 2000} |
| `updated_by` | MASTER_UI / DEFAULT | 是 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
