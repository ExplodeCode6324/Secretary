# CallState

Call 状态由领域模块推进，见 docs/state-machines.md

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/CallState)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

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
  "description": "Call 状态由领域模块推进，见 docs/state-machines.md"
}
```
