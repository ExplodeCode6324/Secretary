# outbox.inbox_dedup

## 1. 定义

`inbox_dedup` 保存消费者对已接收消息的去重键、载荷哈希、处理状态和结果引用。它保证 Outbox 至少一次投递不会重复创建任务、重复完成步骤或重复产生外部副作用。

权威写入者为各消费者的 Inbox Handler。幂等记录必须和消费者业务效果在同一事务中提交。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `consumer_id` | `text` | 是 | 消费者逻辑名称和兼容版本 |
| `message_id` | `uuid` | 是 | 通常为 Outbox Event ID |
| `event_type` | `text` | 是 | 收到的领域事件类型 |
| `payload_hash` | `text` | 是 | 实际收到载荷的哈希 |
| `status` | `text` | 是 | `RECEIVED`、`PROCESSING`、`PROCESSED` 或 `FAILED` |
| `received_at` | `timestamptz` | 是 | 首次接收时间 |
| `processing_started_at` | `timestamptz` | 否 | 处理开始时间 |
| `processed_at` | `timestamptz` | 否 | 业务效果提交时间 |
| `result_ref` | `text` | 否 | 已创建或更新业务对象的精确引用 |
| `error_code` | `text` | 否 | 稳定错误码 |
| `attempt_count` | `integer` | 是 | 消费处理尝试次数 |
| `expires_at` | `timestamptz` | 否 | 幂等窗口到期时间；有外部副作用时通常长期保留 |
| `trace_id` | `uuid` | 是 | 跨层追踪标识 |

主键为 `(consumer_id, message_id)`。

## 3. 不可变量

1. 同一消费者和消息标识只能创建一条记录。
2. 同一 `message_id` 再次到达且 `payload_hash` 不同，必须视为协议完整性故障并停止处理。
3. `PROCESSED` 与消费者业务效果必须在同一事务中提交。
4. 已 `PROCESSED` 的重复消息返回原 `result_ref`，不得再次执行业务逻辑。
5. 对外部副作用消息，幂等记录不得早于外部系统可安全去重的最长窗口删除。
6. `FAILED` 是否可重试由错误分类和消费者协议决定，不得清除记录后伪装成首次处理。

## 4. 关系与索引

- `message_id -> outbox.outbox_event.outbox_event_id`，跨传输系统时也保持原消息 ID。
- 主键：`(consumer_id, message_id)`。
- 恢复索引：`(consumer_id, status, received_at)`。
- 保留扫描索引：`expires_at`。

## 5. 示例

```yaml
consumer_id: task-projector/v1
message_id: 0199ac00-0000-7000-8000-000000000001
event_type: task.status_changed
payload_hash: sha256:110a...
status: PROCESSED
received_at: 2026-09-02T04:31:00.030Z
processing_started_at: 2026-09-02T04:31:00.031Z
processed_at: 2026-09-02T04:31:00.041Z
result_ref: execution.task_projection:0199a970-0000-7000-8000-000000000001
attempt_count: 1
trace_id: 0199ac00-0000-7000-8000-000000000099
```
