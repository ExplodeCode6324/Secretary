# 数据所有权与关联

字段全集见 [逐结构参考](data/README.md)。当前运行时权威校验来自 `src/contracts/contracts.schema.json`；schema 中的设计预留字段仍需结合创建和读取代码判断。尤其 RuntimeConfig 目前没有作为运行配置记录加载，实际启动配置来自环境变量和 live wrapper。

| 数据组 | 主要关联 | 写入方与消费方 |
| --- | --- | --- |
| Session / Input | session_id、claimed_input_ids、active_loop_id | Host 接收和领取；Input 原文对象持久化后确认 |
| MainPromptSnapshot / Context / ModelCall | loop_id、context_id、call_id、raw_context、system_prompt_hash | Host/context/transport 保存；恢复与调试读取 |
| Consciousness / CompactionJob | consciousness_id、revision、covered_event_sequence | Host 维护摘要与覆盖边界；memory.ts 保留承诺身份 |
| TaskProposal / TaskPlan | proposal_request_id、proposal_ref、workspace、trigger | Scheduler 把不可变提案对象转成可推进计划 |
| Execution / Dispatch / Checkpoint | task_id、execution_id、attempt_id、owner_epoch、checkpoint_id | Scheduler 创建运行实例、执行交接和续接信息 |
| TaskResult / Feedback | result_id、execution_id、input_id | Scheduler 保存结果并发反馈；Host 转成主会话输入 |
| Operation / AuthorizationRequest | scope、authorization_id、action、parameters_hash、display_hash | Authorization 绑定请求与作用；Master UI 决定 |
| DecisionRequest | execution_id、deadline、answer_source | 执行者请求缺失信息；回答不能替代授权许可 |
| WorldChange / WorldCommand | change_id、request_hash、operation_id、evidence | World 接受提案，经过许可后进入数据库事务 |
| Notification | state、内容对象、来源 | Host 创建，UI 确认展示后变为 SENT |
| JournalTransaction / OperationLogRecord | sequence、事件 ID、对象引用 | Store 在同帧提交对象状态、日志与幂等回执 |

## 身份、版本和原件

`id` 通常是宿主分配的 UUID；`revision` 是记录版本，不能代替任务 attempt 或 owner epoch。`ObjectRef` 保存 path、sha256、bytes、media_type，引用对象库原始字节。`request_id` 与请求 hash 共同支持重送幂等，不能用相同 ID 提交不同内容。

TaskPlan 的 ID 即 task_id，一个 plan 可产生多个周期 Execution；Execution.result_id 指向终结结果。Dispatch 记录具体尝试，TaskResult 的模型验收声明不能充当 Operation 已执行回执。Feedback 与 Notification 也不相同：前者把执行状态交给主会话，后者把主会话沟通交给 UI。

## 实际使用限制

Context.messages 的 source_event_ids、omitted_refs 和 wm_fact_versions 当前未全面填充；tools_schema 保存系统消息集合，不能误解为另外一套独立、完整的工具 schema 注册表。精确的请求上下文还保存在 ModelCall.request 和主会话 prompt 快照中。

状态枚举的所有值由 schema 接受，不表示所有迁移已被运行时实现。字段上的来源说明和模型声明需要和原件、操作回执、数据库 receipt 对照；结构合法不等于内容真实。
