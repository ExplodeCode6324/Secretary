# ingestion.processor_checkpoint

## 1. 定义

`processor_checkpoint` 保存 Domain Processor 对某个输入分区的消费位置、处理器版本和恢复状态。它是可变运行协调状态，不是业务事实，也不能代替 Observation。

权威写入者为 Processor Runtime，并通过乐观并发或租约保护更新。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `checkpoint_id` | `uuid` | 是 | 主键 |
| `processor_id` | `text` | 是 | 处理器逻辑名称 |
| `processor_version` | `text` | 是 | 处理算法或代码版本 |
| `input_stream` | `text` | 是 | 输入事件流名称 |
| `partition_key` | `text` | 是 | 输入分区标识 |
| `source_position` | `jsonb` | 是 | 来源定义的可比较消费位置 |
| `last_source_event_id` | `uuid` | 否 | 最近成功提交的源事件 |
| `processed_through_time` | `timestamptz` | 否 | 已完整覆盖的业务时间水位 |
| `status` | `text` | 是 | `ACTIVE`、`PAUSED`、`REPLAYING`、`ERROR` 或 `RETIRED` |
| `lease_owner` | `text` | 否 | 当前处理实例标识 |
| `lease_expires_at` | `timestamptz` | 否 | 当前租约到期时间 |
| `last_error_code` | `text` | 否 | 稳定错误分类，不保存敏感原文 |
| `last_error_at` | `timestamptz` | 否 | 最近错误时间 |
| `version` | `bigint` | 是 | 乐观并发版本，从 `1` 开始 |
| `created_at` | `timestamptz` | 是 | 创建时间 |
| `updated_at` | `timestamptz` | 是 | 最近成功更新的时间 |

## 3. 不可变量

1. `(processor_id, input_stream, partition_key)` 唯一。
2. 正常处理时 `source_position` 只能单调前进。历史重放必须使用独立 checkpoint 或显式 `REPLAYING` 状态。
3. 输出数据与 checkpoint 前进必须在同一事务边界内完成，或通过可证明等价的幂等协议完成。
4. 处理器版本改变时不得默默沿用不兼容位置语义。
5. 租约过期只允许其他实例接管处理，不允许删除先前 Observation。

## 4. 关系与索引

- `last_source_event_id -> ingestion.source_event.source_event_id`。
- 唯一索引：`(processor_id, input_stream, partition_key)`。
- 调度索引：`(status, lease_expires_at)`。
- 运行状态应长期保留；已退休 checkpoint 可归档，但必须保留版本和最终位置。

## 5. 示例

```yaml
checkpoint_id: 0199a720-0000-7000-8000-000000000001
processor_id: project-processor
processor_version: 1.0.0
input_stream: ingestion.source_event
partition_key: github:ExplodeCode6324/Secretary
source_position:
  ingest_time: 2026-09-02T04:20:00Z
  source_event_id: 0199a6f0-6ef0-7000-8000-000000000001
last_source_event_id: 0199a6f0-6ef0-7000-8000-000000000001
processed_through_time: 2026-09-02T04:18:12Z
status: ACTIVE
version: 12
created_at: 2026-09-02T03:00:00Z
updated_at: 2026-09-02T04:20:00Z
```
