# 数据所有权与关联

字段全集见 [逐结构参考](data/README.md)。当前运行时权威校验来自 `src/contracts/contracts.schema.json`；schema 中的设计预留字段仍需结合创建和读取代码判断。尤其 RuntimeConfig 目前没有作为运行配置记录加载，实际启动配置来自环境变量和 live wrapper。

| 数据组 | 主要关联 | 写入方与消费方 |
| --- | --- | --- |
| CoreIdentity / AssistantProfile / ClientRegistration | owner_id、profile revision、client resource ID | ApplicationService 初始化持久身份/显示名并登记 owner 客户端；不授予远程权限 |
| SyncMetadata / DeliveryTarget | history_id、持久签名材料、client_id 与 binding nonce | owner 显式初始化/目标管理；不公开签名材料 |
| NotificationRouting / NotificationDelivery | notification_id、目标 client_id、content_version、三类 ACK 时间 | NotificationService 原子路由与显式 ACK；查询只读 |
| ApiCommand | owner_id、request_hash、arguments_ref、resource_ids、result_ref | ApplicationService 持久受理、重放与长命令恢复；同 ID 还检查历史内部请求身份 |
| Session / Input | session_id、claimed_input_ids、active_loop_id | Host 接收和领取；Input 原文对象持久化后确认 |
| MainPromptSnapshot / Context / ModelCall | loop_id、context_id、call_id、raw_context、system_prompt_hash | Host/context/transport 保存；恢复与调试读取 |
| Consciousness / CompactionJob | consciousness_id、revision、covered_event_sequence | Host 维护摘要与覆盖边界；memory.ts 保留承诺身份 |
| TaskProposal / TaskPlan | proposal_request_id、proposal_ref、workspace、trigger | Scheduler 把不可变提案对象转成可推进计划 |
| Execution / Dispatch / Checkpoint | task_id、execution_id、attempt_id、owner_epoch、checkpoint_id | Scheduler 创建运行实例、执行交接和续接信息 |
| TaskResult / Feedback | result_id、execution_id、input_id | Scheduler 保存结果并发反馈；Host 转成主会话输入 |
| Operation / AuthorizationRequest | scope、authorization_id、action、parameters_hash、display_hash | Authorization 绑定请求与作用；Master UI 决定 |
| DecisionRequest | execution_id、deadline、answer_source | 执行者请求缺失信息；回答不能替代授权许可 |
| WorldChange / WorldCommand | change_id、request_hash、operation_id、evidence | World 接受提案，经过许可后进入数据库事务 |
| SettingsDraft / SettingsApplication | payload_ref、source_ref、candidate_ref、context_id、runtime_settings_hash | Settings 管理待应用内容、覆盖清单、候选进度和生效回执；Session/Context 关联生效版本 |
| Notification | state、内容对象、来源 | Host 创建；旧控制器的 SENT 仅作历史证据；新版 Delivery ACK 单独保存各目标事实 |
| JournalTransaction / OperationLogRecord | sequence、事件 ID、对象引用 | Store 在同帧提交对象状态、日志与幂等回执 |

## 身份、版本和原件

`id` 通常是宿主分配的 UUID；`revision` 是记录版本，不能代替任务 attempt 或 owner epoch。`ObjectRef` 保存 path、sha256、bytes、media_type，引用对象库原始字节。`request_id` 与请求 hash 共同支持重送幂等，不能用相同 ID 提交不同内容。

TaskPlan 的 ID 即 task_id，一个 plan 可产生多个周期 Execution；Execution.result_id 指向终结结果。Dispatch 记录具体尝试，TaskResult 的模型验收声明不能充当 Operation 已执行回执。Feedback 与 Notification 也不相同：前者把执行状态交给主会话，后者把主会话沟通交给 UI。

## 实际使用限制

Context.messages 的 source_event_ids、omitted_refs 和 wm_fact_versions 当前未全面填充；tools_schema 保存系统消息集合，不能误解为另外一套独立、完整的工具 schema 注册表。精确的请求上下文还保存在 ModelCall.request 和主会话 prompt 快照中。

状态枚举的所有值由 schema 接受，不表示所有迁移已被运行时实现。字段上的来源说明和模型声明需要和原件、操作回执、数据库 receipt 对照；结构合法不等于内容真实。

## 每轮任务要求

TaskPlan.proposal_ref 是计划基线；Execution.proposal_ref 是本轮不可变有效提案，不能互相替代。接续要求从指定最新 parent 的快照继承，显式修订形成新对象，E1 的要求和产物不随 E2 工作文件变化。TaskPlan.pending_requests 保存即时请求，周期时间点仍由 pending_occurrences 保存；省略新增字段的旧记录按[持久化兼容规则](persistence.md)读取。

TaskProposal.source_context_refs 标记正式来源，context_refs 则包含本轮全部来源和直接 parent 的派生证据。只继承来源可避免把旧提示包递归嵌入后续执行；完整原始 checkpoint 仍由持久引用保留。


## 公开 DTO 与内部记录

[内部 schema](../src/contracts/contracts.schema.json) 用于持久化及领域校验；[API schema](api/v1/schema.json) 定义客户端读写合同。前者 revision/sequence/bytes 多为整数，后者投影为十进制字符串；PostgreSQL Date 转为 UTC ISO。公开 Source/Artifact 不暴露 ObjectRef.path。用户领域 JSON（审批 parameters、事实 value、决定 answer、predicate value_schema）原值保留，不能当作 Store 元数据过滤。

CoreIdentity.owner_id 同时标识当前数据域；instance_id 是服务本次启动身份，重启变化。ClientRegistration 不持有独立授权或业务会话。AssistantProfile.name 为空白时公共显示名回退 secretary，与 UserInstructions 和人格设置分离。

TaskResult.artifacts 的 artifact_id 独立于文件名，重名仍能定位原执行。文件工作副本变化不改写 CAS；归档产物在 API 上明确不可读。verified_by 保留 NOT_VERIFIED，submit_result 不自动生成外部验算证明。
