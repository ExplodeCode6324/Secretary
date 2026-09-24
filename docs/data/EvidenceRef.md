# EvidenceRef

World Model 证据引用；同时定位原始事件与字节。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/EvidenceRef)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `log_event_id` | ID | 是 | 对应 OperationLogRecord.event_id 关联：[ID](ID.md) |
| `content` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
