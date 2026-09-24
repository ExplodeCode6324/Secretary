# SafetyRule

只能收紧执行条件；不能生成授权或改变未知停止要求。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/SafetyRule)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "SafetyRule" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `created_by` | MASTER_UI / MAIN | 是 |  |
| `max_known_failure_retries` | integer | 是 |  {"minimum": 0, "maximum": 9007199254740991} |
| `retryable_error_codes` | array<string> | 是 |  {"minItems": 0} |
| `require_no_effect_for_retry` | true | 是 |  |
| `stop_on_unknown` | true | 是 |  |
| `extra_checks` | array<string> | 是 |  {"minItems": 0} |

## 组合约束

```json
{
  "additionalProperties": false
}
```
