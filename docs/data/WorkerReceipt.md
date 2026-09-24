# WorkerReceipt

PID 仅线索；核对 worker_instance/attempt，不能凭 PID 判断同一进程。

来源：[contracts.schema.json](../../src/contracts/contracts.schema.json#/$defs/WorkerReceipt)。此页自动生成；行为以调用模块为准。

| 字段 | 类型 / 值域 | 必填 | 说明与约束 |
| --- | --- | --- | --- |
| `schema_version` | 1 | 是 |  |
| `record_type` | "WorkerReceipt" | 是 |  |
| `id` | ID | 是 |  关联：[ID](ID.md) |
| `revision` | integer | 是 | 宿主 CAS revision；从 1 开始。 {"minimum": 1, "maximum": 9007199254740991} |
| `updated_at` | Time | 是 |  关联：[Time](Time.md) |
| `dispatch_id` | ID | 是 |  关联：[ID](ID.md) |
| `attempt_id` | ID | 是 |  关联：[ID](ID.md) |
| `execution_id` | ID | 是 |  关联：[ID](ID.md) |
| `owner_epoch` | integer | 是 |  {"minimum": 1, "maximum": 9007199254740991} |
| `worker_instance_id` | ID | 是 |  关联：[ID](ID.md) |
| `pid` | integer 或 null | 是 |  |
| `status` | STARTED / CHECKPOINT / EXITED / LOST | 是 |  |
| `checkpoint_id` | ID 或 null | 是 |  关联：[ID](ID.md) |
| `exit_code` | integer 或 null | 是 |  |
| `observed_at` | Time | 是 |  关联：[Time](Time.md) |

## 组合约束

```json
{
  "additionalProperties": false
}
```
