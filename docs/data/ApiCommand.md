# ApiCommand

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/ApiCommand)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。字段存在不等于全部语义已实现，行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "ApiCommand" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 |  {"minimum": 1} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `owner_id` | ID | 是 |  关联：[ID](ID.md) |
| `command` | string | 是 |  |
| `request_hash` | Digest | 是 |  关联：[Digest](Digest.md) |
| `state` | ACCEPTED / QUEUED / RUNNING / COMPLETED / FAILED / UNKNOWN | 是 |  |
| `arguments_ref` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `resource_ids` | array<object> | 是 |  关联：[ID](ID.md) |
| `error_code` | ['string', 'null'] | 是 |  |
| `result_ref` | ObjectRef 或 null | 是 |  关联：[ObjectRef](ObjectRef.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
