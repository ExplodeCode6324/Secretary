# execution.approval

## 1. 定义

`approval` 保存 Master 对特定任务、动作、资源、对象、额度和时间范围作出的授权决定。它是授权权威状态，不等于模型的授权请求，也不能从自然语言暗示中自动推导。

权威写入者为 Approval Service。授权主体必须可验证为 Master。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `approval_id` | `uuid` | 是 | 主键 |
| `master_entity_id` | `uuid` | 是 | 授权主体 |
| `request_decision_id` | `uuid` | 是 | 请求授权的 Decision Record |
| `task_id` | `uuid` | 否 | 授权适用任务 |
| `action_id` | `uuid` | 否 | 单动作授权 |
| `risk_class` | `text` | 是 | 授权覆盖的风险等级 |
| `scope` | `jsonb` | 是 | 账户、资源、对象、操作类型和内容范围 |
| `limits` | `jsonb` | 是 | 金额、次数、频率和累计额度 |
| `allow_subtask_inheritance` | `boolean` | 是 | 是否允许满足约束的子任务继承 |
| `status` | `text` | 是 | `PENDING`、`GRANTED`、`DENIED`、`REVOKED`、`EXPIRED` 或 `CONSUMED` |
| `granted_at` | `timestamptz` | 否 | 授权时间 |
| `expires_at` | `timestamptz` | 否 | 到期时间 |
| `revoked_at` | `timestamptz` | 否 | 撤销时间 |
| `consumed_count` | `integer` | 是 | 已使用次数 |
| `decision_interaction_id` | `uuid` | 否 | Master 决定的交互事实 |
| `version` | `bigint` | 是 | 乐观并发版本 |
| `created_at` | `timestamptz` | 是 | 创建时间 |
| `updated_at` | `timestamptz` | 是 | 最近更新时间 |

## 3. 不可变量

1. `GRANTED` 必须关联经认证的 Master 决定和 `granted_at`。
2. 授权范围默认不继承，只有 `allow_subtask_inheritance=true` 且子任务未扩大范围时才能继承。
3. 高风险等级不能由低风险授权覆盖。
4. 到期、撤销、额度耗尽或次数耗尽后不得继续使用。
5. 授权检查在动作下发前执行，并使用当前 Approval 版本。
6. Approval 不保存凭据，只保存可操作资源的逻辑范围。
7. LLM 不能通过回复草稿、任务目标或上下文文本创建授权。

## 4. 关系与索引

- 引用 Master Entity、Decision Record、Task、Action 和 Interaction Event。
- 被 Action 引用。
- 有效授权索引：`(status, expires_at, risk_class)`。
- 任务索引：`task_id`；动作索引：`action_id`。
- 对涉及金额或次数的授权，消费计数更新必须和动作下发在同一事务边界中保护。

## 5. 示例

```yaml
approval_id: 0199a950-0000-7000-8000-000000000001
master_entity_id: 0199a100-0000-7000-8000-000000000001
request_decision_id: 0199aa10-0000-7000-8000-000000000002
task_id: 0199a900-0000-7000-8000-000000000001
risk_class: REVERSIBLE
scope:
  resource_prefix: /workspace/Secretary/docs/datastructure
  operations:
    - create_document
    - update_document
limits:
  max_operations: 64
allow_subtask_inheritance: false
status: GRANTED
granted_at: 2026-09-02T04:30:00Z
expires_at: 2026-09-02T12:00:00Z
consumed_count: 20
decision_interaction_id: 0199aa00-0000-7000-8000-000000000001
version: 21
created_at: 2026-09-02T04:30:00Z
updated_at: 2026-09-02T05:20:00Z
```
