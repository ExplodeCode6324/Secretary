# WorldCommandState

状态枚举对应 src/state_machine/catalog.json 的 WorldCommand

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/WorldCommandState)。此页自动生成；行为以调用模块为准。

```json
{
  "type": "string",
  "enum": [
    "RECEIVED",
    "WAIT_AUTH",
    "READY",
    "APPLYING",
    "COMMITTED",
    "CONFLICT",
    "REJECTED",
    "RETRYABLE_ERROR"
  ],
  "description": "状态枚举对应 src/state_machine/catalog.json 的 WorldCommand"
}
```
