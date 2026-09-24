# HostState

状态枚举对应 src/state_machine/catalog.json 的 Host

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/HostState)。此页自动生成；行为以调用模块为准。

```json
{
  "type": "string",
  "enum": [
    "STOPPED",
    "RECOVERING",
    "IDLE",
    "RUNNING",
    "CAPACITY_BLOCKED",
    "RECOVERY_BLOCKED",
    "DRAINING"
  ],
  "description": "状态枚举对应 src/state_machine/catalog.json 的 Host"
}
```
