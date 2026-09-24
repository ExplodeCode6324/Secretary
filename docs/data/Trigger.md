# Trigger

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/Trigger)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `kind` | IMMEDIATE / AT / INTERVAL / EVENT | 是 |  |
| `at` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `interval_seconds` | integer 或 null | 是 |  |
| `anchor_at` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `timezone` | string | 是 | IANA 时区；UTC 时写 Etc/UTC {"minLength": 1} |
| `event_source` | string 或 null | 是 |  |
| `predicate_id` | string 或 null | 是 |  |
| `missed_policy` | REPORT_ONLY / SKIP / CATCH_UP_ONE | 是 |  |
| `overlap_policy` | QUEUE / SKIP | 是 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
