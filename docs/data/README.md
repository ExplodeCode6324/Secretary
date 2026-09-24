# 结构化数据字段索引

由 `npm run docs:generate` 从运行时 JSON Schema 生成。逐字段说明包括继承字段；required 表示必须出现，nullable 是否允许 null 由类型/组合约束决定。完整条件约束见各页引用的 Schema。

Schema 是结构校验来源，TypeScript contracts.ts 是生成类型。字段存在不代表所有语义已实现：例如 Context 的 source_event_ids / omitted_refs / wm_fact_versions 当前没有完整填充；状态 catalog 也不是全局运行时 guard。

所有持久化记录由 Store.shape 校验，普通请求与嵌套定义由调用点 shape/shapeDefinition 或宿主逻辑校验。`record_type + id` 定位记录，revision 用于版本检查，ObjectRef 用 SHA-256 引用不可变原件。

运行源码：[contracts.schema.json](../../src/contracts/contracts.schema.json)、[contracts.ts](../../src/pi_secretary/src/contracts.ts)、[Store](../../src/pi_secretary/src/store.ts)。

| 定义 | 字段数 | 说明 |
| --- | ---: | --- |
| [ID](ID.md) | 0 | 宿主产生的 UUID；模型不可冒充宿主或 Master 身份。 |
| [Time](Time.md) | 0 | UTC RFC3339；时区意图在 Trigger.timezone 另存。 |
| [Digest](Digest.md) | 0 | 已保存原始字节 SHA-256 小写十六进制。 |
| [RelativePath](RelativePath.md) | 0 | 相对 data_root 或 workspace_root；运行时拒绝绝对路径、..、符号链接越界。 |
| [HostState](HostState.md) | 0 | 状态枚举对应 src/state_machine/catalog.json 的 Host |
| [InputState](InputState.md) | 0 | 状态枚举对应 src/state_machine/catalog.json 的 Input |
| [CallState](CallState.md) | 0 | 状态枚举对应 src/state_machine/catalog.json 的 Call |
| [CompactionState](CompactionState.md) | 0 | 状态枚举对应 src/state_machine/catalog.json 的 Compaction |
| [PlanState](PlanState.md) | 0 | 状态枚举对应 src/state_machine/catalog.json 的 Plan |
| [ExecutionState](ExecutionState.md) | 0 | 状态枚举对应 src/state_machine/catalog.json 的 Execution |
| [RetentionState](RetentionState.md) | 0 | 状态枚举对应 src/state_machine/catalog.json 的 Retention |
| [OperationState](OperationState.md) | 0 | 状态枚举对应 src/state_machine/catalog.json 的 Operation |
| [AuthorizationState](AuthorizationState.md) | 0 | 状态枚举对应 src/state_machine/catalog.json 的 Authorization |
| [DecisionState](DecisionState.md) | 0 | 状态枚举对应 src/state_machine/catalog.json 的 Decision |
| [FeedbackState](FeedbackState.md) | 0 | 状态枚举对应 src/state_machine/catalog.json 的 Feedback |
| [NotificationState](NotificationState.md) | 0 | 状态枚举对应 src/state_machine/catalog.json 的 Notification |
| [WorldCommandState](WorldCommandState.md) | 0 | 状态枚举对应 src/state_machine/catalog.json 的 WorldCommand |
| [ProgramState](ProgramState.md) | 0 | 状态枚举对应 src/state_machine/catalog.json 的 Program |
| [ObjectRef](ObjectRef.md) | 4 | 不可变对象引用；必须校验内容散列。 |
| [Scope](Scope.md) | 3 | 日志定位：main 至少 session；task 必须 task 与 execution；跨域见语义校验。 |
| [Message](Message.md) | 5 | 逻辑消息；provider 扩展块由原始 context 对象保留。 |
| [EvidenceRef](EvidenceRef.md) | 2 | World Model 证据引用；同时定位原始事件与字节。 |
| [Provenance](Provenance.md) | 7 |  |
| [Precondition](Precondition.md) | 4 | 运行前提只引用已登记检查器，禁止运行模型提交的表达式。 |
| [ConditionResult](ConditionResult.md) | 5 |  |
| [Trigger](Trigger.md) | 9 |  |
| [FeedbackPolicy](FeedbackPolicy.md) | 5 |  |
| [ExecutorSpec](ExecutorSpec.md) | 5 |  |
| [Session](Session.md) | 13 | 逻辑主会话；状态变化由宿主单写，进程停止仍保留。 |
| [Input](Input.md) | 13 | 外部输入；工具返回不创建此对象。 |
| [Context](Context.md) | 27 | 一次调用不可变快照；estimated+reserve<=budget 由业务检查。 |
| [ModelCall](ModelCall.md) | 14 | 模型传输生命周期；完整响应保存后才解析工具请求。 |
| [WorkItem](WorkItem.md) | 12 | 事项不等于任务；未履行且无人承接的事项不退出。 |
| [Consciousness](Consciousness.md) | 12 | 当前工作记忆；全部摘要提交与原文承接集合一次保存。 |
| [CompactionJob](CompactionJob.md) | 16 | 固定范围摘要任务；新增输入不纳入覆盖集合。 |
| [TaskProposal](TaskProposal.md) | 18 | 主会话只提出任务；不接受 authorized、grant 等模型声明。 |
| [TaskPlan](TaskPlan.md) | 19 | id 即 task_id；先保存计划再建幂等目录，agent 在可执行时由 dispatch 拉起。 |
| [Execution](Execution.md) | 24 | 执行生命周期与短期留存是独立维度；终结历史不可回到 RUNNING。 |
| [Dispatch](Dispatch.md) | 15 | Scheduler -> worker 固定分派；重复 attempt_id 返回既有回执，不重新起进程。 |
| [WorkerReceipt](WorkerReceipt.md) | 15 | PID 仅线索；核对 worker_instance/attempt，不能凭 PID 判断同一进程。 |
| [Checkpoint](Checkpoint.md) | 18 | 宿主保存原 context + 接续说明；恢复不执行历史工具。 |
| [Artifact](Artifact.md) | 5 |  |
| [TaskResult](TaskResult.md) | 16 | 完整结果先可查询，再反馈简要结论；PARTIAL/UNKNOWN 不意味着执行已结束。 |
| [Feedback](Feedback.md) | 15 | 短结论与执行引用；主会话读到时详情已保存。 |
| [DecisionRequest](DecisionRequest.md) | 16 | 普通决定通过 TaskControl；授权走独立接口。 |
| [ActionScope](ActionScope.md) | 6 |  |
| [Operation](Operation.md) | 17 | 最终 gate 的单位；权限、取消、对象版本在此核验。 |
| [AuthorizationRequest](AuthorizationRequest.md) | 16 | host/scheduler 私有记录，模型不可提交批准状态。 |
| [ApprovalCommand](ApprovalCommand.md) | 7 | 仅已认证 Master UI 可调用；身份取服务端 session，不能从 body 信任。 |
| [AuthorizationRule](AuthorizationRule.md) | 13 | 手工确认的持续规则，主会话无写入口；每次操作匹配当前 revision。 |
| [SafetyRule](SafetyRule.md) | 11 | 只能收紧执行条件；不能生成授权或改变未知停止要求。 |
| [ProgramRegistration](ProgramRegistration.md) | 17 | 人工登记；dispatch 固定 revision+code digest，更新不改历史。 |
| [Notification](Notification.md) | 12 | 主会话普通通知；独立于授权 UI 展示。 |
| [OperationLogRecord](OperationLogRecord.md) | 14 | 逻辑原始日志；MAIN/TASK 并列，不替代任务查询状态。 |
| [ArchiveManifest](ArchiveManifest.md) | 11 | 退出 Scheduler 前完整性检查；归档不删除长期历史。 |
| [WorldChange](WorldChange.md) | 21 | 主会话或登记来源提案；SQL 内不保存授权范围。 |
| [WorldCatalogChange](WorldCatalogChange.md) | 16 | 实体登记/名称修订和不可变来源登记；仍经 Scheduler 授权。谓词由人工迁移维护。 |
| [WorldCommand](WorldCommand.md) | 10 | 跨 JSON journal / PG 的桥接状态；PG commit receipt 才证明已写。 |
| [WorldQuery](WorldQuery.md) | 9 | memory_read 的 World Model 查询分支；游标绑定筛选与快照。 |
| [WorldFact](WorldFact.md) | 13 |  |
| [WorldReadResult](WorldReadResult.md) | 8 | 空结果不自动解释为事实不存在；CONTESTED 全部候选可查询。 |
| [CommandReceipt](CommandReceipt.md) | 8 | 入口幂等回执；同 request_id 不同 hash 返回冲突。 |
| [RuntimeConfig](RuntimeConfig.md) | 12 | 复核默认值见 demo_design/DECISIONS.md，参数不等于 BrainStorm 最终结论。 |
| [TaskQuery](TaskQuery.md) | 8 | DETAIL 成功且 execution 仍 HOT 时刷新留存；LIST 不刷新。 |
| [TaskControlCommand](TaskControlCommand.md) | 8 | 普通任务控制；无 APPROVE 授权操作。 |
| [MemoryReadRequest](MemoryReadRequest.md) | 10 | MemoryUtil 统一读入口；WORLD 需 world_query，其余分支必须为空。 |
| [MemoryReadResult](MemoryReadResult.md) | 10 | 读取只读，不更改 authority 或引发异步新输入。 |
| [TaskQueryResult](TaskQueryResult.md) | 10 | RETIRED 不复活旧执行，返回历史引用。 |
| [ProgramInvocation](ProgramInvocation.md) | 10 | 程序 stdin JSON 协议；stdout 输出结果，stderr 过程日志；超大内容写文件并由宿主收录。 |
| [ProgramResult](ProgramResult.md) | 11 | 必须校验登记 result_schema；退出码 0 不足以证明业务成功。 |
| [Mutation](Mutation.md) | 5 | 服务端加载 snapshot 后按 object_type 校验并执行状态 guards；revision 必须 +1。 |
| [JournalTransaction](JournalTransaction.md) | 10 | 单写事务，frame 原始 payload 字节 checksum 外包；同帧全生效或全不生效。 |
| [MemoryCommitment](MemoryCommitment.md) | 6 |  |
| [UserInstructions](UserInstructions.md) | 7 |  |
| [MainPromptSnapshot](MainPromptSnapshot.md) | 10 |  |
