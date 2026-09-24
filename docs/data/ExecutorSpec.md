# ExecutorSpec

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/ExecutorSpec)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `kind` | AGENT / PROGRAM | 是 |  |
| `agent_profile` | string 或 null | 是 |  |
| `program_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `program_revision` | integer 或 null | 是 |  |
| `parameters` | JSON | 是 | 程序参数须再通过登记的 parameters_schema 校验；agent 参数为 {}。 |

## 组合约束

```json
{
  "additionalProperties": false
}
```
