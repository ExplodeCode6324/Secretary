# ApprovalCommand

仅已认证 Master UI 可调用；身份取服务端 session，不能从 body 信任。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/ApprovalCommand)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "ApprovalCommand" | 是 |  |
| `request_id` | ID | 是 |  关联：[ID](ID.md) |
| `authorization_id` | ID | 是 |  关联：[ID](ID.md) |
| `expected_revision` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `display_hash` | Digest | 是 |  关联：[Digest](Digest.md) |
| `decision` | APPROVE / REJECT / REVOKE | 是 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
