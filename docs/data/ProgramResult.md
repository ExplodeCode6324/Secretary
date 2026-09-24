# ProgramResult

必须校验登记 result_schema；退出码 0 不足以证明业务成功。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/ProgramResult)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "ProgramResult" | 是 |  |
| `dispatch_id` | ID | 是 |  关联：[ID](ID.md) |
| `execution_id` | ID | 是 |  关联：[ID](ID.md) |
| `outcome` | SUCCEEDED / FAILED / WAITING / UNKNOWN | 是 |  |
| `summary` | string | 是 |  {"minLength": 1} |
| `detail` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `artifacts` | array<Artifact> | 是 |  {"minItems": 0} 关联：[Artifact](Artifact.md) |
| `effect` | NOT_STARTED / APPLIED / NOT_APPLIED / PARTIAL / UNKNOWN | 是 |  |
| `resume_ref` | ObjectRef 或 null | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `evidence` | array<ObjectRef> | 是 |  {"minItems": 1} 关联：[ObjectRef](ObjectRef.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
