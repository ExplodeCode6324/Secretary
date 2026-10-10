# SettingsDraft

Master 待应用修改；payload 为 SettingsPayload，不是有效设置。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/SettingsDraft)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。字段存在不等于全部语义已实现，行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `record_type` | "SettingsDraft" | 是 |  |
| `payload_ref` | ObjectRef | 是 | 不可变 SettingsPayload 对象；保存草稿不会修改有效设置。 关联：[ObjectRef](ObjectRef.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
