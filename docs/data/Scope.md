# Scope

日志定位：main 至少 session；task 必须 task 与 execution；跨域见语义校验。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/Scope)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `session_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `task_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `execution_id` | ID 或 null | 是 |  关联：[ID](ID.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
