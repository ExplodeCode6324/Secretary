# interaction.reply_delivery

## 1. 定义

`reply_delivery` 保存 Response Dispatcher 对已释放 Reply Draft 的实际投递状态、幂等键、渠道回执和外部消息标识。它是回复发送状态的权威记录。

权威写入者为 Response Dispatcher 和受控 Delivery Result Handler。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `reply_delivery_id` | `uuid` | 是 | 主键 |
| `reply_draft_id` | `uuid` | 是 | 已释放草稿 |
| `channel` | `text` | 是 | 投递渠道 |
| `destination_ref` | `text` | 是 | 已脱敏目标逻辑引用 |
| `idempotency_key` | `text` | 是 | 渠道投递去重键 |
| `status` | `text` | 是 | 投递状态，见下文 |
| `attempt_count` | `integer` | 是 | 非负尝试次数 |
| `external_message_id` | `text` | 否 | 渠道返回的消息标识 |
| `receipt_evidence_id` | `uuid` | 否 | 外部回执或独立回读证据 |
| `first_dispatched_at` | `timestamptz` | 否 | 首次下发时间 |
| `provider_accepted_at` | `timestamptz` | 否 | 提供方接受时间 |
| `delivery_confirmed_at` | `timestamptz` | 否 | 可证明送达时间 |
| `last_error_class` | `text` | 否 | 重试分类 |
| `last_error_code` | `text` | 否 | 稳定错误码 |
| `next_attempt_at` | `timestamptz` | 否 | 安全重试时间 |
| `version` | `bigint` | 是 | 乐观并发版本 |
| `created_at` | `timestamptz` | 是 | 创建时间 |
| `updated_at` | `timestamptz` | 是 | 最近更新时间 |

投递状态：`PENDING`、`DISPATCHED`、`PROVIDER_ACCEPTED`、`DELIVERY_CONFIRMED`、`FAILED`、`RESULT_UNKNOWN`、`CANCELLED`。

## 3. 不可变量

1. `(channel, idempotency_key)` 唯一。
2. 只有 `reply_draft.status=RELEASED` 才能创建 Delivery。
3. `PROVIDER_ACCEPTED` 不等于收件人已读取；没有送达回执时不得升级为 `DELIVERY_CONFIRMED`。
4. 响应丢失且可能已发送时必须进入 `RESULT_UNKNOWN` 并通过外部消息 ID 或独立回读对账。
5. `RESULT_UNKNOWN` 不允许盲目重发。
6. 出站 Interaction Event 只能引用已经形成可信发送事实的 Delivery 状态。
7. 目标地址和消息内容不得在普通日志中明文复制。

## 4. 关系与索引

- `reply_draft_id -> interaction.reply_draft.reply_draft_id`。
- `receipt_evidence_id -> ingestion.evidence_index.evidence_id`。
- 被出站 Interaction Event 引用。
- 唯一索引：`(channel, idempotency_key)`。
- 对账索引：`(status, next_attempt_at, updated_at)`。
- 外部标识索引：`(channel, external_message_id)`。

## 5. 示例

```yaml
reply_delivery_id: 0199ab10-0000-7000-8000-000000000001
reply_draft_id: 0199ab00-0000-7000-8000-000000000001
channel: CODEX
destination_ref: conversation:0199aa01-0000-7000-8000-000000000001
idempotency_key: reply:0199ab00:codex
status: PROVIDER_ACCEPTED
attempt_count: 1
external_message_id: assistant-turn-3822
first_dispatched_at: 2026-09-02T05:10:01.500Z
provider_accepted_at: 2026-09-02T05:10:01.520Z
version: 2
created_at: 2026-09-02T05:10:01.490Z
updated_at: 2026-09-02T05:10:01.520Z
```
