# interaction.reply_draft

## 1. 定义

`reply_draft` 保存模型生成的候选回复、释放条件和当前门控状态。Reply Draft 不是已发送消息，不能作为任务提交、授权或外部效果成立的证据。

权威写入者为 Decision Service；释放状态由 Response Release Gate 更新。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `reply_draft_id` | `uuid` | 是 | 主键 |
| `decision_id` | `uuid` | 是 | 来源 Decision Record |
| `conversation_id` | `uuid` | 是 | 目标会话 |
| `in_reply_to_event_id` | `uuid` | 否 | 被回复的 Interaction Event |
| `content_ref` | `text` | 是 | 不可变、已脱敏候选内容引用 |
| `content_hash` | `text` | 是 | 内容哈希 |
| `release_condition_type` | `text` | 是 | 释放条件类型，见下文 |
| `release_subject_ref` | `uuid` | 否 | 对应 Task、Approval、Action 或其他状态标识 |
| `required_subject_version` | `bigint` | 否 | 必须成立的最小精确版本 |
| `status` | `text` | 是 | `DRAFT`、`HELD`、`RELEASED`、`SUPERSEDED` 或 `CANCELLED` |
| `notification_policy` | `jsonb` | 是 | 渠道、显著性和免打扰约束 |
| `created_at` | `timestamptz` | 是 | 创建时间 |
| `released_at` | `timestamptz` | 否 | Release Gate 通过时间 |
| `release_evidence_refs` | `uuid[]` | 是 | 释放依据引用 |
| `version` | `bigint` | 是 | 乐观并发版本 |

释放条件类型：`IMMEDIATE`、`TASK_COMMITTED`、`APPROVAL_GRANTED`、`EFFECT_CONFIRMED`、`TASK_COMPLETED`、`MANUAL_RELEASE`、`NEVER`。

## 3. 不可变量

1. 内容创建后不可改写；修订生成新的 Reply Draft，并将旧草稿标记 `SUPERSEDED`。
2. `TASK_COMMITTED` 必须验证 Task 和对应 Outbox Event 已在同一事务中提交。
3. `EFFECT_CONFIRMED` 必须验证 Action 状态和证据，不得只检查 Action Attempt 成功。
4. `TASK_COMPLETED` 必须验证全部成功条件。
5. `RELEASED` 只表示允许投递，不表示外部渠道已接收。
6. 完成性表述的释放条件不得是 `IMMEDIATE`。
7. 候选内容在释放前必须通过敏感信息和状态一致性检查。

## 4. 关系与索引

- `decision_id -> interaction.decision_record.decision_id`。
- `in_reply_to_event_id -> interaction.interaction_event.interaction_event_id`。
- 被 Reply Delivery 引用。
- 决策索引：`decision_id`。
- 待释放扫描索引：`(status, release_condition_type, created_at)`。
- 会话索引：`(conversation_id, created_at)`。

## 5. 示例

```yaml
reply_draft_id: 0199ab00-0000-7000-8000-000000000001
decision_id: 0199aa10-0000-7000-8000-000000000001
conversation_id: 0199aa01-0000-7000-8000-000000000001
in_reply_to_event_id: 0199aa00-0000-7000-8000-000000000001
content_ref: object://reply-drafts/0199ab00/content
content_hash: sha256:c810...
release_condition_type: TASK_COMMITTED
release_subject_ref: 0199a900-0000-7000-8000-000000000001
required_subject_version: 1
status: HELD
notification_policy:
  channel: CODEX
release_evidence_refs: []
version: 1
created_at: 2026-09-02T05:10:01.410Z
```
