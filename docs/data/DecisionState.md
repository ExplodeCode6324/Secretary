# DecisionState

状态枚举对应 src/state_machine/catalog.json 的 Decision

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/DecisionState)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

```json
{
  "type": "string",
  "enum": [
    "OPEN",
    "ANSWERED",
    "OBSOLETE",
    "EXPIRED"
  ],
  "description": "状态枚举对应 src/state_machine/catalog.json 的 Decision"
}
```
