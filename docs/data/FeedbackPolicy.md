# FeedbackPolicy

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/FeedbackPolicy)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `terminal` | boolean | 是 | 一次性终结必须 true；周期可按约定筛选。 |
| `on_change` | boolean | 是 |  |
| `on_blocker` | true | 是 |  |
| `on_unknown` | true | 是 |  |
| `milestones` | array<string> | 是 |  {"minItems": 0} |

## 组合约束

```json
{
  "additionalProperties": false
}
```
