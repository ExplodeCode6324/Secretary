# FailureHandling

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/FailureHandling)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "FailureHandling" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `failure_key` | string | 是 |  |
| `session_id` | ID | 是 |  关联：[ID](ID.md) |
| `task_id` | ID | 是 |  关联：[ID](ID.md) |
| `execution_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `result_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `disposition` | UNRESOLVED / DISMISSED | 是 |  |
| `dismissed_sequence` | integer 或 null | 是 |  |
| `intent_id` | ID | 是 |  关联：[ID](ID.md) |
| `input_id` | ID | 是 |  关联：[ID](ID.md) |
| `action` | REDO / DISMISS | 是 |  |
| `phase` | REQUESTED / LINKED / BLOCKED / DISMISSED | 是 |  |
| `error` | string 或 null | 是 |  |
| `linked_request_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `requirements_digest` | Digest 或 null | 是 |  关联：[Digest](Digest.md) |
| `tool_receipt` | object 或 null | 是 |  关联：[Digest](Digest.md), [ID](ID.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
