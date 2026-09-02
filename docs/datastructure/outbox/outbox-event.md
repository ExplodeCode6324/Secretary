# outbox.outbox_event

## 1. 定义

`outbox_event` 保存与业务状态同事务提交、等待可靠投递的领域事件。它解决数据库提交与 Worker、Projector 或 Dispatcher 收到事件之间的一致性问题。

业务服务创建不可变事件载荷；Outbox Dispatcher 只更新投递协调字段。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `outbox_event_id` | `uuid` | 是 | 主键和消息标识 |
| `aggregate_type` | `text` | 是 | `TASK`、`ACTION`、`APPROVAL`、`REPLY_DRAFT` 等 |
| `aggregate_id` | `uuid` | 是 | 业务聚合标识 |
| `aggregate_version` | `bigint` | 是 | 业务状态提交后的版本 |
| `event_type` | `text` | 是 | 版本化领域事件类型 |
| `schema_version` | `integer` | 是 | 事件载荷版本 |
| `payload` | `jsonb` | 否 | 小型无敏感载荷 |
| `payload_ref` | `text` | 否 | 大型不可变载荷引用 |
| `payload_hash` | `text` | 是 | 实际载荷哈希 |
| `partition_key` | `text` | 是 | 保序键，通常为聚合标识 |
| `status` | `text` | 是 | `PENDING`、`CLAIMED`、`PUBLISHED`、`FAILED` 或 `DEAD_LETTER` |
| `available_at` | `timestamptz` | 是 | 最早投递时间 |
| `claimed_by` | `text` | 否 | 当前 Dispatcher |
| `claim_expires_at` | `timestamptz` | 否 | 投递租约到期时间 |
| `attempt_count` | `integer` | 是 | 非负投递次数 |
| `published_at` | `timestamptz` | 否 | 成功发布时刻 |
| `last_error_code` | `text` | 否 | 稳定错误码 |
| `created_at` | `timestamptz` | 是 | 与业务事务提交的创建时间 |
| `trace_id` | `uuid` | 是 | 跨层追踪标识 |

## 3. 不可变量

1. Outbox Event 必须与对应业务状态更新在同一数据库事务中创建。
2. `(aggregate_type, aggregate_id, aggregate_version, event_type)` 唯一。
3. 事件类型、载荷、Schema 版本和哈希创建后不可修改。
4. 投递采用至少一次语义，消费者必须通过 Inbox Dedup 实现幂等。
5. 同一 `partition_key` 的事件按 `aggregate_version` 保序；发现版本缺口时消费者停止推进并请求补偿。
6. `PUBLISHED` 只表示事件已交给传输系统，不表示消费者业务处理完成。
7. Secret 不得进入载荷或错误字段。

## 4. 关系与索引

- `aggregate_id` 按类型引用业务结构。
- 被 `outbox.inbox_dedup` 的 `message_id` 去重。
- 唯一索引：`(aggregate_type, aggregate_id, aggregate_version, event_type)`。
- 拉取索引：`(status, available_at, created_at)`。
- 保序索引：`(partition_key, aggregate_version)`。
- Dispatcher 可使用 `FOR UPDATE SKIP LOCKED` 安全领取。

## 5. 示例

```yaml
outbox_event_id: 0199ac00-0000-7000-8000-000000000001
aggregate_type: TASK
aggregate_id: 0199a900-0000-7000-8000-000000000001
aggregate_version: 4
event_type: task.status_changed
schema_version: 1
payload:
  from_status: READY
  to_status: RUNNING
payload_hash: sha256:110a...
partition_key: task:0199a900-0000-7000-8000-000000000001
status: PENDING
available_at: 2026-09-02T04:31:00Z
attempt_count: 0
created_at: 2026-09-02T04:31:00Z
trace_id: 0199ac00-0000-7000-8000-000000000099
```
