# CallState

状态枚举对应 src/state_machine/catalog.json 的 Call

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/CallState)。此页自动生成；行为以调用模块为准。

```json
{
  "type": "string",
  "enum": [
    "PREPARED",
    "IN_FLIGHT",
    "RESPONSE_SAVED",
    "INTERRUPTED",
    "FAILED"
  ],
  "description": "状态枚举对应 src/state_machine/catalog.json 的 Call"
}
```
