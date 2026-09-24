# AuthorizationState

状态枚举对应 src/state_machine/catalog.json 的 Authorization

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/AuthorizationState)。此页自动生成；行为以调用模块为准。

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
