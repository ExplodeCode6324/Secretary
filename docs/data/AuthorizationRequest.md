# AuthorizationRequest

host/scheduler 私有记录，模型不可提交批准状态。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/AuthorizationRequest)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "AuthorizationRequest" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `state` | AuthorizationState | 是 |  关联：[AuthorizationState](AuthorizationState.md) |
| `operation_id` | ID | 是 |  关联：[ID](ID.md) |
| `action` | ActionScope | 是 |  关联：[ActionScope](ActionScope.md) |
| `scope` | Scope | 是 |  关联：[Scope](Scope.md) |
| `display_ref` | ObjectRef | 是 | Master 实际看到的固定展示内容 关联：[ObjectRef](ObjectRef.md) |
| `display_hash` | Digest | 是 |  关联：[Digest](Digest.md) |
| `expires_at` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `decision_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `decided_at` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `decided_by` | "MASTER_UI" 或 null | 是 |  |
| `consumed_at` | Time 或 null | 是 |  关联：[Time](Time.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
