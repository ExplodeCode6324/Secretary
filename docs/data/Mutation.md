# Mutation

服务端加载 snapshot 后按 object_type 校验并执行状态 guards；revision 必须 +1。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/Mutation)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `object_type` | Session / Input / Context / ModelCall / Consciousness / CompactionJob / TaskPlan / Execution / Dispatch / WorkerReceipt / Checkpoint / TaskResult / Feedback / DecisionRequest / Operation / AuthorizationRequest / AuthorizationRule / SafetyRule / ProgramRegistration / Notification / ArchiveManifest / WorldCommand / UserInstructions / MainPromptSnapshot | 是 |  |
| `object_id` | ID | 是 |  关联：[ID](ID.md) |
| `expected_revision` | integer | 是 |  {"minimum": 0, "maximum": 9007199254740991} |
| `new_revision` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `snapshot` | ObjectRef | 是 |  关联：[ObjectRef](ObjectRef.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
