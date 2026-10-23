# AttachmentBinding

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/AttachmentBinding)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `attachment_id` | ID | 是 |  关联：[ID](ID.md) |
| `import_request_id` | ID | 是 |  关联：[ID](ID.md) |
| `name` | string | 是 |  {"pattern": "^[^/\\\\\\x00-\\x1f\\x7f]+$", "minLength": 1, "maxLength": 255} |
| `content` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `width` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `height` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |

## 组合约束

```json
{
  "additionalProperties": false
}
```
