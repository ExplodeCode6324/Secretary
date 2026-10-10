# Trigger

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/Trigger)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。字段存在不等于全部语义已实现，行为以调用模块为准。

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
  "additionalProperties": false,
  "allOf": [
    {
      "if": {
        "properties": {
          "kind": {
            "const": "AT"
          }
        }
      },
      "then": {
        "properties": {
          "at": {
            "$ref": "#/$defs/Time"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "kind": {
            "const": "INTERVAL"
          }
        }
      },
      "then": {
        "properties": {
          "anchor_at": {
            "$ref": "#/$defs/Time"
          },
          "interval_seconds": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991,
            "description": ""
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "kind": {
            "const": "EVENT"
          }
        }
      },
      "then": {
        "properties": {
          "event_source": {
            "type": "string",
            "minLength": 1,
            "description": ""
          },
          "predicate_id": {
            "type": "string",
            "minLength": 1,
            "description": ""
          }
        }
      }
    }
  ]
}
```
