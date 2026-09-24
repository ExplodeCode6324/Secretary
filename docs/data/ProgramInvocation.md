# ProgramInvocation

程序 stdin JSON 协议；stdout 输出结果，stderr 过程日志；超大内容写文件并由宿主收录。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/ProgramInvocation)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "ProgramInvocation" | 是 |  |
| `dispatch_id` | ID | 是 |  关联：[ID](ID.md) |
| `execution_id` | ID | 是 |  关联：[ID](ID.md) |
| `program_id` | ID | 是 |  关联：[ID](ID.md) |
| `program_revision` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `code_digest` | Digest | 是 |  关联：[Digest](Digest.md) |
| `workspace` | RelativePath | 是 |  关联：[RelativePath](RelativePath.md) |
| `parameters` | JSON | 是 |  |
| `resume_ref` | ObjectRef 或 null | 是 |  关联：[ObjectRef](ObjectRef.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
