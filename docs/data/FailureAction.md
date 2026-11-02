# FailureAction

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/FailureAction)。此页自动生成，描述内部合同；客户端使用 [API v1 DTO](../api/v1/README.md)。行为说明见 [数据模型](../data-model.md)。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `failure_key` | string | 是 |  {"pattern": "^(EXECUTION:[0-9a-f-]+\|TASK_INIT:[0-9a-f-]+:[1-9][0-9]*)$"} |
| `expected_revision` | string | 是 |  {"pattern": "^(0\|[1-9][0-9]*)$"} |
| `action` | REDO / DISMISS | 是 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
