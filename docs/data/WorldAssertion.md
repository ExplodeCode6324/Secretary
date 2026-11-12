# WorldAssertion

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/WorldAssertion)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "WorldAssertion" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 |  {"minimum": 1} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `subject_id` | ID | 是 |  关联：[ID](ID.md) |
| `predicate_key` | string | 是 |  |
| `topic` | string | 是 |  |
| `value` | JSON | 是 |  |
| `object_entity_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `keywords` | array<string> | 是 |  {"maxItems": 20} |
| `source_kind` | MASTER / OBSERVATION / TASK_REPORT / MODEL_INFERENCE / UNRESOLVED | 是 |  |
| `evidence_event_ids` | array<ID> | 是 |  关联：[ID](ID.md) |
| `valid_from` | Time | 是 |  关联：[Time](Time.md) |
| `valid_to` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `observed_at` | Time | 是 |  关联：[Time](Time.md) |
| `fresh_until` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `note` | string 或 null | 是 |  |
| `status` | LIVE / SUPERSEDED / RETRACTED | 是 |  |
| `replaces_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `change_id` | ID | 是 |  关联：[ID](ID.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
