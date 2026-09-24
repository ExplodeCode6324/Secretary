# Precondition

运行前提只引用已登记检查器，禁止运行模型提交的表达式。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/Precondition)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `condition_id` | ID | 是 |  关联：[ID](ID.md) |
| `kind` | DEVICE_AVAILABLE / EXECUTION_SUCCEEDED / RESOURCE_PRESENT | 是 |  |
| `target` | string | 是 | 登记设备/资源标识或 execution UUID {"minLength": 1} |
| `required_revision` | string 或 null | 是 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
