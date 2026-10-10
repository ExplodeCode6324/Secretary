# Digest

已保存原始字节 SHA-256 小写十六进制。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/Digest)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。字段存在不等于全部语义已实现，行为以调用模块为准。

```json
{
  "type": "string",
  "minLength": 1,
  "description": "已保存原始字节 SHA-256 小写十六进制。",
  "pattern": "^[0-9a-f]{64}$"
}
```
