# Secretary 数据结构索引

## 1. 文档状态

| 项目 | 值 |
|---|---|
| 状态 | V1 逻辑设计建议 |
| 架构依据 | [`../Design.md`](../Design.md) |
| 覆盖范围 | `ingestion`、`cognition`、`context`、`execution`、`interaction`、`outbox` |
| 数据结构数量 | 39，其中持久化结构 28，模型与服务边界契约 11 |
| 物理实现约束 | PostgreSQL 为结构化权威状态库；对象存储保存大型不可变内容；检索索引可重建且不具备事实权威 |

本文档集细化现有架构，不新增持久化逻辑域，不改变设计文档中的任务状态机、动作状态机、权威写入边界或风险分类。`context` 目录定义模型调用边界上的只读投影契约，不新增权威状态。字段级选择在实现迁移冻结前均属于 V1 建议。

## 2. 跨层数据流

```text
External Source
  -> ingestion.source_event
  -> ingestion.observation
  -> ingestion.derived_feature
  -> cognition.live_world_state
  -> cognition.consciousness_snapshot
  -> context.LiveWorldStateInput / context.WorldModelInput
  -> context.ConsciousnessStateInput
  -> interaction.decision_record
  -> execution.task / execution.action
  -> execution.action_attempt
  -> ingestion.observation
  -> cognition.live_world_state / cognition.world_model_fact

execution.task / interaction.reply_draft
  -> outbox.outbox_event
  -> outbox.inbox_dedup
  -> Worker / Response Dispatcher
```

## 3. 全局数据约定

1. 主标识采用 `uuid`。V1 推荐由权威服务生成 UUIDv7，以获得全局唯一性和近似时间有序性；调用方不得自行复用已存在标识。
2. 时间采用 `timestamptz` 并以 UTC 保存。字段后缀 `_at` 表示时间点，`valid_from` 和 `valid_to` 表示事实或状态的业务有效区间。
3. 所有跨服务载荷均包含 `schema_version`。消费者必须拒绝未知的破坏性版本，不得静默猜测字段语义。
4. 大型正文、文件、截图、音视频、请求和响应进入不可变对象存储。关系表仅保存引用、内容哈希、MIME 类型、大小和保留策略。
5. 任何名称以 `_ref` 结尾的字段只保存不可变对象引用或受控逻辑标识。长期凭据、API Key、令牌和私钥不得进入本目录定义的数据结构。
6. `version` 用于乐观并发控制。更新命令必须携带期望版本；版本不匹配时停止写入并重新读取状态。
7. `source_event`、`observation`、`task_event` 和已终结的 `action_attempt` 为追加式记录。更正通过新记录和 `supersedes_*` 引用完成。
8. `confidence` 的范围为 `[0, 1]`。置信度不等于事实准入，也不能代替证据或权威服务决策。
9. `content_hash` 和 `payload_hash` 推荐使用 SHA-256，并连同实际算法名保存，避免未来迁移时产生歧义。
10. 软删除只适用于可变目录或投影。审计、证据和状态事件不得通过软删除掩盖历史。

## 4. 权威边界

| 状态 | 权威写入者 | 禁止直接写入者 |
|---|---|---|
| 接入事件与观察 | Ingress / Observation Service、Verifier Observation Adapter | LLM、Task Orchestrator |
| 实时世界状态 | State Estimation Service | Executor、LLM |
| 长期世界事实 | World Model Updater | Executor、普通 Worker、LLM |
| 任务当前状态 | Task Service | LLM、普通 Worker、Task Projector |
| 动作执行尝试 | Executor Result Handler | LLM |
| 授权 | Approval Service，授权主体为 Master | LLM、Worker |
| 任务投影与 Open Loop | Task Projector | LLM 任意覆盖 |
| 回复发送状态 | Response Dispatcher | Reply Draft 生成模型 |
| Outbox 投递状态 | Outbox Dispatcher | 业务调用方 |

## 5. 接入与观察域

| 数据结构 | 作用 | 权威性 |
|---|---|---|
| [`ingestion.source_event`](ingestion/source-event.md) | 保存外部源事件 envelope、接入时间和去重依据 | 原始接入事实 |
| [`ingestion.observation`](ingestion/observation.md) | 保存规范化观察和效果回流观察 | 时间观察层权威记录 |
| [`ingestion.derived_feature`](ingestion/derived-feature.md) | 保存可重算的领域派生特征 | 派生数据 |
| [`ingestion.evidence_index`](ingestion/evidence-index.md) | 索引外部回执和不可变证据对象 | 证据元数据权威索引 |
| [`ingestion.processor_checkpoint`](ingestion/processor-checkpoint.md) | 保存 Processor 消费位置和恢复状态 | 运行协调状态 |

## 6. 认知与世界状态域

| 数据结构 | 作用 | 权威性 |
|---|---|---|
| [`cognition.entity`](cognition/entity.md) | 保存人、组织、设备、项目、账户等逻辑实体 | 实体身份目录 |
| [`cognition.assertion`](cognition/assertion.md) | 保存带来源与证据的候选事实 | 候选，不是已接受事实 |
| [`cognition.live_world_state`](cognition/live-world-state.md) | 保存当前有效状态及版本 | 当前状态权威投影 |
| [`cognition.world_model_fact`](cognition/world-model-fact.md) | 保存稳定事实、关系、偏好和长期规律 | 长期认知权威状态 |
| [`cognition.goal`](cognition/goal.md) | 保存当前与长期目标 | 目标权威状态 |
| [`cognition.open_loop`](cognition/open-loop.md) | 保存需要持续注意的未闭环事项 | 派生注意力入口 |
| [`cognition.episodic_memory`](cognition/episodic-memory.md) | 保存重要事件与阶段经历摘要 | 派生记忆，不独立证明事实 |
| [`cognition.consciousness_snapshot`](cognition/consciousness-snapshot.md) | 保存特定时刻的有界意识快照 | 可重建调试快照 |

## 7. 模型输入投影契约

| 数据结构 | 作用 | 权威性 |
|---|---|---|
| [`LiveWorldStateInput`](context/live-world-state-input.md) | 向模型传入带有效期、新鲜度、置信度和 Observation/Evidence 溯源的实时状态切片 | 只读有界投影 |
| [`WorldModelInput`](context/world-model-input.md) | 向模型传入带冲突状态、有效期、置信度和 Assertion/Evidence 溯源的长期事实切片 | 只读有界投影 |
| [`ConsciousnessStateInput`](context/consciousness-state-input.md) | 把实时状态、长期事实、目标、Open Loop 和近期变化组合为带预算与截断说明的调用输入 | 只读调用快照 |
| [`DecisionContext`](context/decision-context.md) | 定义即时决策调用看到的触发、意识状态、任务投影和允许决策类型 | 单次调用输入 |
| [`TaskWorkingContext`](context/task-working-context.md) | 定义任务步骤调用看到的任务版本、当前步骤、结果、授权和相关世界状态 | 单次调用输入 |

这三个结构是模型可见数据的正式边界。数据库记录不得整表直接传入模型；模型也不得通过输出反向修改这些结构或其权威来源。

## 8. 任务与执行域

| 数据结构 | 作用 | 权威性 |
|---|---|---|
| [`execution.task`](execution/task.md) | 保存任务目标、成功条件、约束、风险和当前状态 | 任务主体权威状态 |
| [`execution.task_step`](execution/task-step.md) | 保存任务步骤、依赖、输入、输出和步骤状态 | 步骤权威状态 |
| [`execution.action`](execution/action.md) | 保存原子动作意图、前置条件、预期效果和验证计划 | 动作意图权威状态 |
| [`execution.action_attempt`](execution/action-attempt.md) | 保存每次真实执行尝试和执行结果 | 执行事实 |
| [`execution.task_event`](execution/task-event.md) | 保存追加式任务状态变更日志 | 任务审计事实 |
| [`execution.approval`](execution/approval.md) | 保存 Master 授权范围、限额、有效期和撤销状态 | 授权权威状态 |
| [`execution.artifact`](execution/artifact.md) | 保存报告、代码、日志和截图等任务产物引用 | 产物目录 |
| [`execution.task_projection`](execution/task-projection.md) | 保存面向 Open Loop 和意识层的任务摘要 | 可重建投影 |
| [`execution.worker_lease`](execution/worker-lease.md) | 保存 Worker 租约、心跳和 fencing token | 运行协调状态 |
| [`TaskProposal`](execution/task-proposal.md) | 定义模型提出持久任务候选时的边界结构 | 候选提案 |
| [`ActionProposal`](execution/action-proposal.md) | 定义模型提出原子动作候选时的边界结构 | 候选提案 |
| [`ActionCommand`](execution/action-command.md) | 定义通过全部 Gate 后下发给 Executor 的原子指令 | 可执行传输契约 |
| [`ActionResult`](execution/action-result.md) | 定义 Executor 对一次真实执行尝试返回的结构化结果 | 执行结果，不证明外部效果 |
| [`VerificationResult`](execution/verification-result.md) | 定义 Verifier 或 Reconciler 对外部效果形成的结构化结论 | 验证结论契约 |

## 9. 交互与回复域

| 数据结构 | 作用 | 权威性 |
|---|---|---|
| [`interaction.interaction_event`](interaction/interaction-event.md) | 保存 Master 输入、Secretary 回复和系统通知 | 交互事实 |
| [`interaction.decision_record`](interaction/decision-record.md) | 保存 Decision Envelope、模型版本和上下文引用 | 模型调用审计记录 |
| [`interaction.reply_draft`](interaction/reply-draft.md) | 保存候选回复和释放条件 | 候选内容，不代表已发送 |
| [`interaction.reply_delivery`](interaction/reply-delivery.md) | 保存实际发送状态和外部消息标识 | 回复发送权威状态 |
| [`DecisionEnvelope`](interaction/decision-envelope.md) | 定义模型统一结构化输出、候选回复和决策分支 | 候选输出契约 |

## 10. 可靠事件投递域

| 数据结构 | 作用 | 权威性 |
|---|---|---|
| [`outbox.outbox_event`](outbox/outbox-event.md) | 保存与业务状态同事务提交的待投递事件 | 可靠投递源记录 |
| [`outbox.inbox_dedup`](outbox/inbox-dedup.md) | 保存消费端去重与处理结果 | 消费幂等记录 |

## 11. 完整性检查清单

- 每条任务、动作、尝试和回复均可追溯到触发交互或源事件。
- 每项已确认外部效果均关联独立回读、外部回执、状态比较或明确的低等级验证证据。
- `COMPLETED` 任务的全部成功条件均有验证依据。
- `RESULT_UNKNOWN` 动作先进入对账流程，不自动重试。
- 任务写库和 Outbox 事件在同一事务中提交。
- 模型输出只能生成候选提案、候选事实和候选回复。
- 事实更新、任务更新、授权和回复发送只能由各自权威服务执行。
- 所有可变权威状态均使用版本检查，所有审计事件均保留追加式历史。
