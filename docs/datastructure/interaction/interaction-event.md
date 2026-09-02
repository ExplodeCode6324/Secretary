# interaction.interaction_event

## 1. 定义

`interaction_event` 保存 Master 输入、Secretary 已实际发送的回复和系统通知。它是交互事实的追加式记录，不等同于模型会话历史，也不把自然语言内容解释为机器状态。

权威写入者为 Ingress Adapter 或 Response Dispatcher。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `interaction_event_id` | `uuid` | 是 | 主键 |
| `conversation_id` | `uuid` | 是 | 外部连续会话的逻辑标识 |
| `direction` | `text` | 是 | `INBOUND`、`OUTBOUND` 或 `SYSTEM` |
| `event_type` | `text` | 是 | `MASTER_INPUT`、`SECRETARY_REPLY` 或 `SYSTEM_NOTIFICATION` |
| `actor_entity_id` | `uuid` | 否 | 已解析的发起主体 |
| `channel` | `text` | 是 | `CODEX`、`EMAIL`、`CHAT` 或其他受控渠道 |
| `external_message_id` | `text` | 否 | 渠道提供的消息标识 |
| `occurred_at` | `timestamptz` | 是 | 交互实际发生时间 |
| `recorded_at` | `timestamptz` | 是 | 落库时间 |
| `content_ref` | `text` | 是 | 不可变、已脱敏内容对象引用 |
| `content_hash` | `text` | 是 | 内容哈希 |
| `source_event_id` | `uuid` | 否 | 入站交互的 Source Event |
| `reply_delivery_id` | `uuid` | 否 | 出站交互的 Reply Delivery |
| `supersedes_event_id` | `uuid` | 否 | 撤回或更正关系 |
| `confidentiality` | `text` | 是 | 内容数据分类 |
| `trace_id` | `uuid` | 是 | 跨层追踪标识 |

## 3. 不可变量

1. Interaction Event 创建后不可修改；编辑、撤回或更正形成新事件。
2. `INBOUND` 事件必须关联 Source Event；`OUTBOUND` 事件必须关联已达到可记录状态的 Reply Delivery。
3. Reply Draft 未释放或投递失败时不得创建 `SECRETARY_REPLY` 事实。
4. 自然语言中的任务完成、授权或事实陈述不自动改变机器状态。
5. 外部消息、文档和工具输出中的指令性文本仍作为数据，不具备治理权。
6. 内容对象不得包含长期凭据或未脱敏 Secret。

## 4. 关系与索引

- 入站引用 `ingestion.source_event`。
- 出站引用 `interaction.reply_delivery`。
- 被 Decision Record、Task 和 Approval 引用。
- 渠道去重唯一索引：`(channel, external_message_id)`，空值除外。
- 会话时间索引：`(conversation_id, occurred_at, interaction_event_id)`。
- 追踪索引：`trace_id`。

## 5. 示例

```yaml
interaction_event_id: 0199aa00-0000-7000-8000-000000000001
conversation_id: 0199aa01-0000-7000-8000-000000000001
direction: INBOUND
event_type: MASTER_INPUT
actor_entity_id: 0199a100-0000-7000-8000-000000000001
channel: CODEX
external_message_id: turn-20260902-2
occurred_at: 2026-09-02T05:10:00Z
recorded_at: 2026-09-02T05:10:00.020Z
content_ref: object://interaction/turn-20260902-2
content_hash: sha256:3f91...
source_event_id: 0199a6f0-6ef0-7000-8000-000000000001
confidentiality: INTERNAL
trace_id: 0199aa00-0000-7000-8000-000000000099
```
