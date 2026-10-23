# AttachmentImport

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/AttachmentImport)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "AttachmentImport" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `attachment_id` | ID | 是 |  关联：[ID](ID.md) |
| `expected_sha256` | Digest | 是 |  关联：[Digest](Digest.md) |
| `expected_bytes` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `reserved_bytes` | integer | 是 |  {"minimum": 0} |
| `state` | PENDING / READY / FAILED | 是 |  |
| `error_code` | ['string', 'null'] | 是 |  |
| `validation_limits` | object | 是 |  {"additionalProperties": false} |

## 组合约束

```json
{
  "additionalProperties": false
}
```
