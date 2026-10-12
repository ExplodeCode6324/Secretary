# Time

UTC RFC3339；时区意图在 Trigger.timezone 另存。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/Time)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

```json
{
  "type": "string",
  "minLength": 1,
  "description": "UTC RFC3339；时区意图在 Trigger.timezone 另存。",
  "format": "date-time",
  "pattern": "Z$"
}
```
