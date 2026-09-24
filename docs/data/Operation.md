# Operation

最终 gate 的单位；权限、取消、对象版本在此核验。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/Operation)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "Operation" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `scope` | Scope | 是 |  关联：[Scope](Scope.md) |
| `state` | OperationState | 是 |  关联：[OperationState](OperationState.md) |
| `action` | ActionScope | 是 |  关联：[ActionScope](ActionScope.md) |
| `authorization_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `rule_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `rule_revision` | integer 或 null | 是 |  |
| `owner_epoch` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `attempt_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `retry_of` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `receipt` | ObjectRef 或 null | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `effect` | NOT_STARTED / APPLIED / NOT_APPLIED / PARTIAL / UNKNOWN | 是 |  |
| `error` | string 或 null | 是 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
