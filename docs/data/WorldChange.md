# WorldChange

主会话或登记来源提案；SQL 内不保存授权范围。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/WorldChange)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "WorldChange" | 是 |  |
| `request_id` | ID | 是 |  关联：[ID](ID.md) |
| `change_id` | ID | 是 |  关联：[ID](ID.md) |
| `request_hash` | Digest | 是 |  关联：[Digest](Digest.md) |
| `source_id` | ID | 是 |  关联：[ID](ID.md) |
| `subject_id` | ID | 是 |  关联：[ID](ID.md) |
| `predicate_key` | string | 是 |  {"minLength": 1} |
| `scope_key` | string | 是 | 单值为空，多值为稳定实例键；不能用随机键逃避冲突。 |
| `expected_revision` | integer | 是 |  {"minimum": 0, "maximum": 9007199254740991} |
| `mode` | ASSERT / CORRECT / RETRACT | 是 |  |
| `value` | JSON | 是 | 按 predicate 定义校验；关系采用 object_entity_id，标量采用 value。 |
| `object_entity_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `assertion_id` | ID | 是 |  关联：[ID](ID.md) |
| `replaces_assertion_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `resolve_conflict_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `resolution_note` | string 或 null | 是 |  |
| `provenance` | Provenance | 是 |  关联：[Provenance](Provenance.md) |
| `valid_from` | Time | 是 |  关联：[Time](Time.md) |
| `valid_to` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `fresh_until` | Time 或 null | 是 |  关联：[Time](Time.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
