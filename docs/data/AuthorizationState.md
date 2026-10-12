# AuthorizationState

状态枚举对应 src/state_machine/catalog.json 的 Authorization

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/AuthorizationState)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

```json
{
  "type": "string",
  "enum": [
    "PENDING",
    "APPROVED",
    "REJECTED",
    "REVOKED",
    "EXPIRED",
    "CONSUMED"
  ],
  "description": "状态枚举对应 src/state_machine/catalog.json 的 Authorization"
}
```
