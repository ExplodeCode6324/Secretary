# WorldEdit

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/WorldEdit)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `kind` | FACT / ENTITY | 是 |  |
| `expected_revision` | integer | 是 |  {"minimum": 0} |
| `entity_kind` | PERSON / ORGANIZATION / PROJECT / DEVICE / SERVICE / RESOURCE / GOAL | 否 |  |
| `display_name` | string | 否 |  {"minLength": 1, "maxLength": 500} |
| `external_key` | ['string', 'null'] | 否 |  {"maxLength": 500} |
| `retire` | boolean | 否 |  |
| `mode` | ASSERT / CORRECT / RETRACT | 否 |  |
| `predicate_key` | string | 否 |  {"pattern": "^[a-z][a-z0-9_.]+$", "maxLength": 200} |
| `scope_key` | string | 否 |  {"maxLength": 500} |
| `value` | JSON | 否 |  |
| `resolution_note` | ['string', 'null'] | 否 |  {"maxLength": 2000} |
| `entity_id` | ID | 否 |  关联：[ID](ID.md) |
| `subject_id` | ID | 否 |  关联：[ID](ID.md) |
| `assertion_id` | ID | 否 |  关联：[ID](ID.md) |
| `object_entity_id` | ID 或 null | 否 |  关联：[ID](ID.md) |
| `resolve_conflict_id` | ID 或 null | 否 |  关联：[ID](ID.md) |
| `valid_from` | Time | 否 |  关联：[Time](Time.md) |
| `valid_to` | Time 或 null | 否 |  关联：[Time](Time.md) |
| `fresh_until` | Time 或 null | 否 |  关联：[Time](Time.md) |

## 组合约束

```json
{
  "additionalProperties": false,
  "allOf": [
    {
      "if": {
        "properties": {
          "kind": {
            "const": "ENTITY"
          }
        }
      },
      "then": {
        "required": [
          "entity_id",
          "entity_kind",
          "display_name"
        ]
      },
      "else": {
        "required": [
          "mode",
          "subject_id",
          "predicate_key",
          "scope_key"
        ]
      }
    }
  ]
}
```
