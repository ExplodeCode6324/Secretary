# Provenance

当前运行契约中的结构或共享类型。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/Provenance)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `source_kind` | MASTER / OBSERVATION / TASK_REPORT / MODEL_INFERENCE | 是 |  |
| `source_id` | ID | 是 | wm.source 主键 关联：[ID](ID.md) |
| `evidence` | array<EvidenceRef> | 是 |  {"minItems": 1} 关联：[EvidenceRef](EvidenceRef.md) |
| `observed_at` | Time 或 null | 是 |  关联：[Time](Time.md) |
| `received_at` | Time | 是 |  关联：[Time](Time.md) |
| `scope` | string | 是 | 对象和适用范围 {"minLength": 1} |
| `epistemic` | OBSERVED / REPORTED / INFERRED / UNRESOLVED | 是 |  |

## 组合约束

```json
{
  "additionalProperties": false
}
```
