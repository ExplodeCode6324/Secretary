# AuthorizationState

状态枚举对应 src/state_machine/catalog.json 的 Authorization

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/AuthorizationState)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。字段存在不等于全部语义已实现，行为以调用模块为准。

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
