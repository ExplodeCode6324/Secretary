# ExecutionState

状态枚举对应 src/state_machine/catalog.json 的 Execution

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/ExecutionState)。此页自动生成；行为以调用模块为准。

```json
{
  "type": "string",
  "enum": [
    "CREATED",
    "WAIT_PRECONDITION",
    "READY",
    "DISPATCHING",
    "RUNNING",
    "WAIT_DECISION",
    "WAIT_AUTH",
    "CANCEL_REQUESTED",
    "RESULT_UNKNOWN",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "EXPIRED"
  ],
  "description": "状态枚举对应 src/state_machine/catalog.json 的 Execution"
}
```
