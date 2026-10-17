# NotificationState

Notification 状态由领域模块推进，见 docs/state-machines.md

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/NotificationState)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

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
  "description": "Notification 状态由领域模块推进，见 docs/state-machines.md"
}
```
