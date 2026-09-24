# ObjectRef

不可变对象引用；必须校验内容散列。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/ObjectRef)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `path` | RelativePath | 是 |  关联：[RelativePath](RelativePath.md) |
| `sha256` | Digest | 是 |  关联：[Digest](Digest.md) |
| `bytes` | integer | 是 | 原始字节长度 {"minimum": 0, "maximum": 9007199254740991} |
| `media_type` | string | 是 | 如 application/json；不得用摘要代替原件。 {"minLength": 1} |

## 组合约束

```json
{
  "additionalProperties": false
}
```
