# Artifact

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/Artifact)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `artifact_id` | ID | 是 |  关联：[ID](ID.md) |
| `name` | string | 是 |  {"minLength": 1} |
| `content` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |
| `workspace_path` | RelativePath | 是 |  关联：[RelativePath](RelativePath.md) |
| `producing_operation_id` | ID 或 null | 是 |  关联：[ID](ID.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
