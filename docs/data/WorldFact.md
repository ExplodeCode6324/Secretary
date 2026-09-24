# WorldFact

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/WorldFact)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `subject_id` | ID | 是 |  关联：[ID](ID.md) |
| `predicate_key` | string | 是 |  {"minLength": 1} |
| `scope_key` | string | 是 |  |
| `slot_revision` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `assertion_id` | ID | 是 |  关联：[ID](ID.md) |
| `status` | ACTIVE / SUPPORTING / CONTESTED / RETRACTED / SUPERSEDED | 是 |  |
| `value` | JSON | 是 |  |
| `object_entity_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `provenance` | Provenance | 是 |  关联：[Provenance](Provenance.md) |
| `valid_from` | Time | 是 |  关联：[Time](Time.md) |
| `valid_to` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `freshness` | CURRENT / STALE / UNKNOWN | 是 |  |
| `fresh_until` | Time 或 null | 是 |  关联：[Time](Time.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
