# AuthorizationRule

手工确认的持续规则，主会话无写入口；每次操作匹配当前 revision。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/AuthorizationRule)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "AuthorizationRule" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `state` | ENABLED / DISABLED | 是 |  |
| `actions` | array<string> | 是 |  {"minItems": 1} |
| `resource_prefixes` | array<string> | 是 |  {"minItems": 1} |
| `parameter_constraints` | ObjectRef | 是 | 由注册校验器解释的约束，不运行任意代码 关联：[ObjectRef](ObjectRef.md) |
| `valid_from` | Time | 是 |  关联：[Time](Time.md) |
| `expires_at` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `created_by` | "MASTER_UI" | 是 |  |
| `confirmation_ref` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
