# ActionScope

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/ActionScope)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `action` | string | 是 | 已登记操作类型，如 file.write、world.change；不能任意解释 natural-language。 {"minLength": 1} |
| `resource` | string | 是 | 规范化对象标识 {"minLength": 1} |
| `parameters_ref` | ObjectRef | 是 | 所有关键参数不可变内容 关联：[ObjectRef](ObjectRef.md) |
| `parameters_hash` | Digest | 是 |  关联：[Digest](Digest.md) |
| `expected_resource_revision` | string 或 null | 是 |  |
| `intent_id` | ID | 是 | 一个业务作用的身份；已成功作用不能因新 operation_id 重做。 关联：[ID](ID.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
