# OperationState

状态枚举对应 src/state_machine/catalog.json 的 Operation

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/OperationState)。此页自动生成；行为以调用模块为准。

```json
{
  "type": "string",
  "enum": [
    "PREPARED",
    "WAIT_AUTH",
    "AUTHORIZED",
    "DISPATCHED",
    "SUCCEEDED",
    "FAILED",
    "RESULT_UNKNOWN",
    "CANCELLED"
  ],
  "description": "状态枚举对应 src/state_machine/catalog.json 的 Operation"
}
```
