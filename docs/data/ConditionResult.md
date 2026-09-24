# ConditionResult

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/ConditionResult)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `condition_id` | ID | 是 |  关联：[ID](ID.md) |
| `status` | MET / NOT_MET / UNKNOWN | 是 |  |
| `checked_at` | Time | 是 |  关联：[Time](Time.md) |
| `evidence` | array<ObjectRef> | 是 |  {"minItems": 0} 关联：[ObjectRef](ObjectRef.md) |
| `reason` | string 或 null | 是 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
