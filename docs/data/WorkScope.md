# WorkScope

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/WorkScope)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。字段存在不等于全部语义已实现，行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "Scope" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `name` | string | 是 |  {"minLength": 1, "maxLength": 120} |
| `description` | string | 是 |  {"maxLength": 2048} |
| `kind` | DIRECTORY / NONE | 是 |  |
| `root_path` | ['string', 'null'] | 是 |  |
| `notes_path` | ['string', 'null'] | 是 |  |
| `state` | ACTIVE / ARCHIVED | 是 |  |

## 组合约束

```json
{
  "additionalProperties": false,
  "allOf": [
    {
      "if": {
        "properties": {
          "kind": {
            "const": "NONE"
          }
        }
      },
      "then": {
        "properties": {
          "root_path": {
            "type": "null"
          },
          "notes_path": {
            "type": "null"
          }
        }
      },
      "else": {
        "properties": {
          "root_path": {
            "type": "string",
            "minLength": 1
          },
          "notes_path": {
            "type": "string",
            "minLength": 1
          }
        }
      }
    }
  ]
}
```
