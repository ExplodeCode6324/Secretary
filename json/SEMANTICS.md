# 字段之间的语义约束

Schema 负责形状与值域；以下规则由相应领域服务 校验，不以 schema PASS 代替。字段字典不重复定义这些规则。

| 编号 | 管理方 | 约束 |
| --- | --- | --- |
| J01 | ingress | request_id/dedupe_key 在 producer 下稳定；同键同摘要返回旧回执，同键不同摘要拒绝。请求散列使用入口接收并保存的精确业务 UTF-8 字节（不含服务端后补的 hash 字段，见 API.md），JSON 属性换序不等同同一请求。 |
| J02 | store | revision 从 1 开始；Mutation.expected_revision 等于当前，new_revision=expected+1；不存在对象 expected=0。 |
| J03 | context | MAIN 必须 session_id 非空且 execution_id 为空；TASK 相反；COMPACTION 关联 session。message 顺序、工具调用 ID、raw_context 及 profile 一致；未配对工具不能被裁掉。 |
| J04 | context | estimated_tokens + reserve_tokens <= token_budget；必要原文不能放 omitted_refs；缺省不可代表无信息。 |
| J05 | consciousness | covered 集合只能来自本 job source 且已经主会话处理；commit 要求 base_revision 当前，待输入和新到原文保留；未履行无人承接事项不能退出。 |
| J06 | scheduler | TaskProposal 合法才接受；保存 task_id 后建 workspace。程序 kind=PROGRAM 必须有 program_id/revision 且参数过登记 schema；AGENT 不带程序标识。 |
| J07 | scheduler | IMMEDIATE 只产生一次 occurrence；AT 需 at；INTERVAL 需 anchor+seconds，按固定 UTC 周期；EVENT 需登记来源和谓词；其余互斥 trigger 字段须 null。时区必须合法 IANA。 |
| J08 | scheduler | (task_id,occurrence_key) 唯一；同计划默认不并发，排队或跳过须显式约定。missed_policy 无值不替用户补跑；提案入口由宿主填 REPORT_ONLY 建议默认并回显。 |
| J09 | scheduler | task/execution/attempt/owner_epoch 均匹配才处理 worker 状态；迟到证据可记录但不能覆盖当前控制状态。 |
| J10 | retention | 只有终态、无 pending 决定/授权/未知操作/未处理反馈/未结束后续工作才回收；ttl 从 max(ended_at,last_activity_at) 算；列表扫描不刷新。archive manifest 校验通过后才 RETIRED。 |
| J11 | feedback | details 与 TaskResult 先保存；feedback.execution_id 必须等于 result.execution_id；input_id 与反馈交接同事务。 |
| J12 | authorization | ApprovalCommand 仅 UI auth middleware 可进入；body 没 actor 字段。display_hash、scope、参数 hash、expected_revision、时效须一致；普通 DecisionRequest 回答不能授予权限。 |
| J13 | gate | 参数对象 hash 与 ActionScope.parameters_hash 一致；规范化资源不可在批准后替换；最终检查取消意图、规则/grant 当前版本、owner/attempt 和业务 intent 去重；消费与 dispatch 意图同帧。 |
| J14 | recovery | Context 原字节校验后重载；兼容 adapter/profile 才能发起新调用。已发生工具只载入返回，不重放动作；pending 操作先恢复其结果状态。 |
| J15 | operation | DISPATCHED 无回执 => RESULT_UNKNOWN；核验前禁止原业务作用新 attempt；FAILED 仅在 effect=NOT_APPLIED 且安全规则允许时可创建 retry_of 的新操作。 |
| J16 | logging | TASK 日志 scope 必须 task_id+execution_id；MAIN 至少 session_id；sequence 全局递增（流查询可有间隔）；原文对象不可变，读日志不刷新 Scheduler TTL。 |
| J17 | worldmodel | WorldChange 的 source_id=provenance.source_id；predicate 已登记，scope_key 满足单/多值，标量与关系互斥；权限内容不进入 WM；mode/replace 一致。 |
| J18 | ordinary decision | scope、revision、问题未失效；未回复不等于同意；answer_request_id 幂等；回答应用与执行 READY 同帧。 |
| J19 | program | 分派前当前 enabled 且参数兼容；dispatch 固定程序 revision+code_digest。禁用不篡改运行中证据，也不代表实际停止。 |
| J20 | notification | delivery_key 稳定；SENT 要求渠道回执，DELIVERY_UNKNOWN 不自动重发；与 Master 已读无关。 |
| J21 | filesystem | 所有相对路径解析后仍在约定根目录；对象内容 hash/bytes 匹配；context/log 由框架保存，不只靠 agent 总结。 |

程序参数与 World Model value 的可扩展 JSON 必须再校验登记 schema，不是任意字段透传工具。ID、actor、revision、state、epoch、sequence 等控制字段由服务端生成或核验，LLM 返回的同名值不会直接成为可信状态。

WorldChange ASSERT 增加证据主张；CORRECT/RETRACT 必须定位同 slot 的 replaces_assertion_id。CONTESTED 的解决还须明确选择哪些候选并有新依据，见 schema/TRANSACTIONS.md；不能用更新时间晚自动获胜。完整授权记录只在 Scheduler JSON，不在 PostgreSQL。

## 补充交叉约束

- Checkpoint.executor_kind=AGENT 时 context_id/raw_context 必须非空且 program_resume_ref 为空；PROGRAM 时 context 字段为空，仅支持恢复的程序才要求 program_resume_ref。通用接续说明两者均保存。
- Execution.continuation_of 和 pending_followup_ids 构成可验证的后续关联。新后续执行接受、旧记录刷新/挂起退休同事务；后续结束解除阻挡并刷新旧执行活动时间。不能仅检查旧执行自己的 waiting_request_ids。
- Precondition 必须引用登记检查器及有效 target；ConditionResult 缺失、过时或 UNKNOWN 时不得分派。每次准备执行重新检查；依赖执行是否成功以 Scheduler 为准。
- Context、Dispatch、Checkpoint、TaskResult 内容一经提交保持不可变；新调用/接续/更新结果创建新 ID，状态记录仅更换引用。Mutation 不使这些记录获得任意覆盖权。
- WorldCatalogChange UPSERT_ENTITY 需要 entity_id/kind/display_name，source 字段为空；expected_revision=0 创建，修订只改展示名称/外部键，kind 不变。REGISTER_SOURCE 需要 source_id/kind/key/description，entity 字段为空且 expected_revision=0；来源性质不可改写成更可信的类别。
- WorldChange.resolve_conflict_id 非空只适用于 CORRECT，必须明确非空 resolution_note，且 replaces 指向冲突成员。仓储锁定同 slot 的全部未决候选，用新证据解决它们；其他模式两个字段都为空。RETRACT 的 value/object_entity_id 为空，assertion_id=replaces_assertion_id。
- TaskControlCommand ANSWER_DECISION 要求 decision_request_id/answer 非空；其余控制不可带回答。TaskQuery DETAIL 必须 execution_id，LIST/CAPABILITIES 不接受用无意义 ID 刷新 TTL。MemoryReadRequest WORLD 只用 world_query，其余分支不用；跨分支字段必须为空。
- 读取 EXACT raw_context 并不承诺更换模型厂商后格式兼容。保存完整适配器输入（含扩展块），相同 profile/adapter 下恢复；变化时先完成可审查迁移，不静默丢弃未知块。
- 来源真实性由后端按 EvidenceRef 对应原始日志及认证入口核对，模型不能将自己的推断标成 MASTER/OBSERVED。事实值可以来自对 Master 明确陈述的提取，但额外推论仍须标 INFERRED；来源类型不是允许写权限。
- Program 的 Operation、授权消费与 Execution.DISPATCHING/Dispatch 同帧提交，之后才 exec；不能以“程序启动后再让它申请”为前提。动作资源/参数改变必须新建操作；旧批准作废。规则过期但原动作未变可重建批准请求。
- TaskProposal.reuse_task_id 非空时必须有 parent_execution_id，属于同一仍可接续的 task，父执行尚未 RETIRED，且已终结；目标、约束、executor 与计划一致。形成额外的 IMMEDIATE occurrence，key 为本次 request_id，不重写周期时间表。实质改变目标/约束或原计划已 CLOSED 时只能创建新计划。新计划可引用历史，不能直接调起 RETIRED 的旧执行。
