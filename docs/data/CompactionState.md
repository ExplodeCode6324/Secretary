# CompactionState

状态枚举对应 src/state_machine/catalog.json 的 Compaction

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/CompactionState)。此页自动生成；行为以调用模块为准。

```json
{
  "type": "string",
  "enum": [
    "QUEUED",
    "SUMMARIZING",
    "VALIDATING",
    "COMMITTED",
    "STALE",
    "FAILED"
  ],
  "description": "状态枚举对应 src/state_machine/catalog.json 的 Compaction"
}
```
