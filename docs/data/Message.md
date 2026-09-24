# Message

逻辑消息；provider 扩展块由原始 context 对象保留。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/Message)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `message_id` | ID | 是 |  关联：[ID](ID.md) |
| `role` | system / developer / user / assistant / tool | 是 |  |
| `content` | ObjectRef | 是 | 完整内容，含多模态引用；不在此做摘要。 关联：[ObjectRef](ObjectRef.md) |
| `tool_call_id` | string 或 null | 是 |  |
| `source_event_ids` | array<ID> | 是 |  {"minItems": 0} 关联：[ID](ID.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
