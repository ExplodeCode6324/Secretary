# NotificationState

状态枚举对应 src/state_machine/catalog.json 的 Notification

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/NotificationState)。此页自动生成；行为以调用模块为准。

```json
{
  "type": "string",
  "enum": [
    "QUEUED",
    "SENDING",
    "SENT",
    "FAILED",
    "DELIVERY_UNKNOWN"
  ],
  "description": "状态枚举对应 src/state_machine/catalog.json 的 Notification"
}
```
