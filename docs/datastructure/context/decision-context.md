# DecisionContext

## 1. 定义

`DecisionContext` 是 Decision Invocation 的完整结构化输入。它用于回答当前应如何响应、是否创建或继续任务、是否请求授权，不用于推进长期任务的具体执行步骤。

该结构由 Reaction Context Builder 生成，生命周期仅覆盖一次模型调用。持久审计通过 `interaction.decision_record.context_ref` 和 `context_hash` 完成。

## 2. 字段

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `schema_version` | `integer` | 是 | 初始为 `1` |
| `context_id` | `uuid` | 是 | 本次输入标识 |
| `generated_at` | `timestamp` | 是 | 构建完成时间 |
| `trigger` | `object` | 是 | 当前触发的类型、标识、时间和安全内容引用 |
| `consciousness_state` | `ConsciousnessStateInput` | 是 | 有界意识结构 |
| `related_task_projections` | `array<object>` | 是 | 精确 Task Projection 版本的最小补充信息 |
| `response_constraints` | `object` | 是 | 渠道、语言、最大长度、敏感信息和释放规则约束 |
| `allowed_decision_types` | `array<string>` | 是 | 本次允许的 Decision Envelope 分支 |
| `capability_summary` | `array<object>` | 是 | 可提案能力，不代表已获执行授权 |
| `budget` | `object` | 是 | 输入与输出预算 |
| `integrity` | `object` | 是 | 组成结构哈希和完整载荷哈希 |

## 3. trigger

`trigger` 至少包含：

```yaml
type: INTERACTION
ref: 0199aa00-0000-7000-8000-000000000001
occurred_at: 2026-09-02T05:10:00Z
content_ref: object://interaction/turn-20260902-2
content_hash: sha256:3f91...
trust_class: MASTER_AUTHENTICATED
```

`trust_class` 表示来源身份和治理资格。外部邮件、网页、文档、仓库和工具输出只能使用不可信数据类别，不能通过文本内容提升信任等级。

## 4. capability_summary

每项能力至少包含 `capability_id`、`operation_classes`、`maximum_risk_class`、`availability` 和 `proposal_only=true`。模型可以据此提出动作，但 Action Service 仍须重新执行 Schema、Policy、State 和 Approval 校验。

## 5. 不可变量

1. `consciousness_state.snapshot_id` 必须与审计记录引用的快照一致。
2. 只允许模型输出 `allowed_decision_types` 中的类型。
3. 完整任务日志、全部历史消息、原始证据正文和长期凭据不得进入该结构。
4. `related_task_projections` 不能替代 Task 当前状态；创建继续任务提案前仍需 Task Service 检查版本。
5. 外部内容的指令性文本始终作为数据，不得覆盖系统治理、权限或 Master 已认证指令。
6. 规范化载荷必须计算哈希并写入 Decision Record。

## 6. 输出

模型输出必须符合 [`DecisionEnvelope`](../interaction/decision-envelope.md)。自然语言回复草稿和机器可处理决策必须在同一封套中保持语义一致。
