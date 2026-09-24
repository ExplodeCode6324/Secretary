# RuntimeConfig

复核默认值见 demo_design/DECISIONS.md，参数不等于 BrainStorm 最终结论。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/RuntimeConfig)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "RuntimeConfig" | 是 |  |
| `data_root` | string | 是 |  {"minLength": 1} |
| `workspace_root` | string | 是 |  {"minLength": 1} |
| `postgres_dsn_env` | string | 是 | 仅环境变量名，不存口令 {"minLength": 1} |
| `retention_seconds` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `context_budget` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `context_reserve` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `compaction_threshold` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `max_workers` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `max_frame_bytes` | integer | 是 |  {"minimum": 1024, "maximum": 9007199254740991} |
| `max_input_bytes` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |

## 组合约束

```json
{
  "additionalProperties": false
}
```
