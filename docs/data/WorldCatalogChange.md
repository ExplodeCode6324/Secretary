# WorldCatalogChange

实体登记/名称修订和不可变来源登记；仍经 Scheduler 授权。谓词由人工迁移维护。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/WorldCatalogChange)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "WorldCatalogChange" | 是 |  |
| `request_id` | ID | 是 |  关联：[ID](ID.md) |
| `change_id` | ID | 是 |  关联：[ID](ID.md) |
| `request_hash` | Digest | 是 |  关联：[Digest](Digest.md) |
| `kind` | UPSERT_ENTITY / REGISTER_SOURCE | 是 |  |
| `entity_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `entity_kind` | PERSON / ORGANIZATION / PROJECT / DEVICE / SERVICE / RESOURCE / GOAL 或 null | 是 |  |
| `display_name` | string 或 null | 是 |  |
| `external_key` | string 或 null | 是 |  |
| `source_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `source_kind` | MASTER / OBSERVATION / TASK_REPORT / MODEL_INFERENCE 或 null | 是 |  |
| `source_key` | string 或 null | 是 |  |
| `description` | string 或 null | 是 |  |
| `expected_revision` | integer | 是 |  {"minimum": 0, "maximum": 9007199254740991} |
| `evidence` | array<EvidenceRef> | 是 |  {"minItems": 1} 关联：[EvidenceRef](EvidenceRef.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
