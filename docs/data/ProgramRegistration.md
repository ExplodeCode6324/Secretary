# ProgramRegistration

人工登记；dispatch 固定 revision+code digest，更新不改历史。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/ProgramRegistration)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "ProgramRegistration" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `state` | ProgramState | 是 |  关联：[ProgramState](ProgramState.md) |
| `name` | string | 是 |  {"minLength": 1} |
| `description` | string | 是 |  {"minLength": 1} |
| `entrypoint` | string | 是 | 受人工登记控制；参数用 argv，禁止模型拼 shell 字符串。 {"minLength": 1} |
| `code_digest` | Digest | 是 |  关联：[Digest](Digest.md) |
| `parameters_schema` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `result_schema` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `preconditions` | array<string> | 是 |  {"minItems": 0} |
| `operation_kinds` | array<string> | 是 |  {"minItems": 0} |
| `supports_resume` | boolean | 是 |  |
| `maintained_by` | "HUMAN" | 是 |  |
| `validation_ref` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
