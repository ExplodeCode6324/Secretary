> 历史归档：设计阶段的原始设计或早期实现说明，和当前代码不构成证据对应。命令、路径与结论仅供历史追溯；当前入口见 [项目文档](../../README.md)。

# 转换守卫条件

所有转换还须通过 schema_version、请求身份、对象归属、expected_revision、去重、状态合法性检查。守卫失败返回有原因的拒绝，不静默跳到目标状态。状态表中的 commit 必须在副作用前或与领域状态一起可靠提交；外部调用不能放在 journal 重放函数内。

| guard | 必须满足的条件 |
| --- | --- |
| `all_owned_state_durable` | 宿主未确认但尚未持久化的输入/输出为零；活跃外部操作已有意图记录。 |
| `base_and_coverage_valid` | base_revision 等于当前 Consciousness；覆盖是固定原文子集；未履行承诺与工具配对检查通过；候选对象可靠保存。 |
| `base_changed` | 当前 Consciousness revision 不等于任务 base_revision。 |
| `before_retirement_commit` | 在 RETIRED 事务提交之前持有同一 revision；已退休返回历史入口不重新 HOT。 |
| `call_checkpoint_safe` | 上次完整响应已保存；工具请求与返回成对，未决工具继续走操作状态机。 |
| `cannot_fit_context` | 已保留所有必要原文后 estimated_tokens+reserve_tokens>token_budget。 |
| `channel_evidence` | 查询渠道的证据对应原 delivery_key；无法查明则保持 DELIVERY_UNKNOWN。 |
| `channel_ready` | 普通通知渠道已配置；稳定 delivery_key 已保存。 |
| `checkpoint_requested` | 停止发起新模型调用，等待当前可见交互边界，不将 cancel 当作工具已停止。 |
| `checkpoint_saved` | loop checkpoint 及待输入已经 journal durable。 |
| `complete_response` | provider 明确结束响应且完整字节已保存；流式片段不满足。 |
| `completion_proven` | 证据说明取消生效前工作已完成，不写 CANCELLED。 |
| `context_durable` | Context 及 raw_context/tools_schema 对象散列通过且均已 fsync。 |
| `context_fits` | 摘要提交成功且新 Context 预算满足；未承接原文仍存在。 |
| `control_authorized` | 合法的 TaskControl 操作，仍在有效授权及对象 revision 内。 |
| `deadline_elapsed` | 存在 expires_at/deadline 且当前时刻达到；null 不过期。 |
| `deadline_elapsed_and_no_inflight` | 显式截止时间已到且没有在途/未知作用；否则先停止核验。 |
| `definite_not_sent` | 渠道明确拒绝且证明未发送。 |
| `definite_not_started` | 执行端明确证明未启动，非仅缺少回执。 |
| `definitive_error` | 收到明确模型失败响应而非未知外部工具作用。 |
| `delivery_receipt` | 渠道明确报告发送/投递结果，不能推断 Master 已读。 |
| `denied` | Scheduler 返回拒绝/过期，未触发 PG 写入。 |
| `details_durable` | TaskResult/详情对象已 durable，且创建 Input 与反馈 DELIVERED 同帧。 |
| `durable_receipt` | 同 operation 的结果原文与证据已写，回执匹配。 |
| `effects_unknown` | 已请求取消但外部作用仍无法确定。 |
| `enabled_revision_and_no_overlap` | 计划 ACTIVE（已受理 occurrence 关闭例外须记录）、程序当前 ENABLED且兼容、无同计划并发执行；参数/授权前提有效。 |
| `evidence` | 核验材料明确证实原 operation 的作用，不能用重做来测试。 |
| `exclusive_owner` | 应用已取得 data_root 独占系统文件锁；主会话唤起复用该锁与 owner_epoch，不能再取得第二把锁。锁未取得不得写状态或分派。 |
| `explicit_deadline` | 仅对显式 deadline 到期处理。 |
| `final_gate` | 当前 owner/attempt、取消代次、授权/规则版本、对象版本、参数摘要、intent 去重都通过；批准消费与意图同帧提交。 |
| `grant_current` | 批准/规则未撤销或过期，匹配操作；此处不是消费 grant。 |
| `grant_or_target_changed` | 授权撤销/过期或请求的范围已变，原批准不得复用。 |
| `hash_matches` | PG receipt request_hash 等于原请求且 outcome=APPLIED；不同 hash 拒绝，CONFLICT/REJECTED 走对应恢复边。 |
| `human_control` | 人工禁用登记；不能将其视为已终止正在运行者。 |
| `human_validated` | 人工维护入口确认参数/结果 schema、代码摘要和运行前提，非模型自动登记。 |
| `identity_verified` | 原 worker 的实例身份与 attempt 核对；PID 单独不足；接回后仅新 epoch 可派新操作。 |
| `invalid_payload` | 结构/来源/谓词/参数不合法；授权不能修复数据错误。 |
| `known_effects` | 失败与作用范围有明确回执；部分已发生不允许自动重跑。 |
| `known_error` | 记录具体文件系统失败，不能将已有不匹配目录视为成功。 |
| `known_failed` | 收到确定失败回执，已知实际影响与剩余工作。 |
| `known_failure` | 摘要调用明确失败，不变更 covered 集合。 |
| `logs_objects_durable_and_no_pending` | ArchiveManifest 包含完整 Task Log 与对象且校验成功；再次检查所有 pending 条件为零。 |
| `loop_effects_recorded` | 本 loop 的完整回复、工具结果、提交回执均可靠保存；只完成本批 claimed_input_ids。 |
| `loop_handled` | 对应 Input 为 HANDLED；不因只展示结论就宣称已处理。 |
| `master_reject_or_expire` | 该请求已拒绝或显式期限已过，尚未执行。 |
| `master_ui` | 身份来自服务器 UI session；模型提供 actor 字段无效。 |
| `master_ui_and_scope_match` | UI 身份通过，request revision、display_hash 和冻结 scope 一致且未过期。 |
| `master_ui_valid` | 已认证 Master UI 提交匹配请求 revision 与 display_hash 的批准。 |
| `matching_epoch_attempt` | 回执的 execution_id、attempt_id、owner_epoch 与当前分派一致。 |
| `materials_saved` | 完整 context 与接续材料可读取；工作决定请求已保存。 |
| `may_have_sent` | 连接丢失等导致发送结果不明。 |
| `may_have_started` | 存在 dispatch 意图但未能证明未启动；不 spawn 第二个 worker。 |
| `missing_effect_result` | 至少一项已分派作用无法确认；记录 unknown_operation_ids。 |
| `missing_or_corrupt` | 必需对象缺失、非尾部日志损坏、未知 schema 或引用不一致。 |
| `new_evidence` | 核验记录针对同 execution/operation 且引用可验证；未知不能仅靠主会话一句话消除。 |
| `no_active_loop` | 无 active_loop_id；不要求无计划或无待输入。 |
| `no_complete_response` | 没有完整响应记录；不得从片段解析工具。 |
| `no_future_occurrence` | 一次性计划已产生规定 occurrence 或明确关闭；已有执行独立管理。 |
| `no_inflight_effect` | 没有 DISPATCHED/RESULT_UNKNOWN 操作；否则转取消核验流程。 |
| `no_tools_from_partial` | 证明中断响应未产生任何已分派工具；否则先恢复工具。 |
| `one_job_and_fixed_source` | 该会话无其他可提交摘要；source_event_ids/ref 集合固定，排除未处理输入。 |
| `operation_prepared` | 操作对象与参数已冻结，AuthorizationRequest 关联同一 Operation。 |
| `operator_repaired` | 人工修复后重新验证，而非忽略损坏或重新生成空会话。 |
| `outcome_unknown` | 请求可能已生效但缺明确回执；停下并查证。 |
| `pending_input_and_capacity` | 至少一个 ACCEPTED 输入且不存在其他 loop；Context 含保留原文并满足预算。 |
| `pg_reachable_and_no_receipt` | PG 可查询且已确认同 change_id 未提交；同一键再执行事务。 |
| `pg_receipt_exists` | PG change_receipt 已提交且 request_hash 相同；本地日志可补交接。 |
| `preconditions_met` | 设备、依赖、程序可用，截止期未过；WAIT 不隐含成功。 |
| `recovery_complete` | journal 完整帧、对象散列、引用与 PG 待交接已核对；未知外部操作已隔离，不要求先消除所有业务未知。 |
| `registered_predicate_and_provenance` | 事实变更要求 entity/source/predicate 有效及 value_schema/来源/时间通过；目录变更要求 WorldCatalogChange 条件满足。均不包含权限描述。 |
| `request_revision_matches` | 普通决定关联具体 request 和 revision；已经处理则返回旧回执。 |
| `request_valid` | 请求已认证、revision 匹配、该执行未终结。 |
| `response_and_effects_durable` | 同 loop 输出与全部工具结果/未决处理决定已保存；用户被通知不是必要条件。 |
| `result_and_evidence_saved` | 完整 TaskResult、详情对象和证据已 durable，result_id 可立即查询。 |
| `revision_mismatch` | 锁内 slot.revision 与 expected_revision 不匹配，返回冲突不覆盖。 |
| `rule_matches` | 已启用授权规则匹配规范化 action/resource/参数约束及当前版本。 |
| `same_loop_checkpoint` | CLAIMED 输入关联原 loop；缺 checkpoint 则恢复阻塞，不能从头重做操作。 |
| `same_task_id` | 复用原提案回执的 task_id，不分配新任务。 |
| `scope_changed` | 待决定事项范围已变，原问题和答复不再可用。 |
| `single_loop` | Session 当前无另一 active_loop；认领的输入为 ACCEPTED。 |
| `stop_and_effects_known` | worker/程序停止已确认，所有已分派作用的结果已知。 |
| `targeted_detail_or_followup` | 明确针对 execution 的成功详情查询或已接受的后续接续；列表、扫描不算。 |
| `task_cannot_continue` | 拒绝/失效使当前任务按原要求无法继续，持久化失败原因及已发生影响。 |
| `terminal_no_pending_and_ttl` | Execution 终态；无待决定/授权/未知作用/未处理反馈；now>=max(ended_at,last_activity_at)+ttl。 |
| `trigger_due` | 基于保存的 Trigger 产生唯一 occurrence_key；无重复/错过补跑违规。 |
| `unknown_pg_commit` | 连接断开无法判断 COMMIT 是否成功；禁止新 change_id 重试。 |
| `valid_decision_and_conditions` | 具体待决定事项已 ANSWERED，revision 匹配，检查恢复前提。 |
| `valid_grant_or_rule` | 统一 Scheduler 返回有效放行依据，World Model 不保存权限范围。 |
| `valid_new_input` | 来源已认证、大小/Schema/去重校验通过；旧请求只返回旧回执。 |
| `valid_not_covered` | 操作合法且有可显示固定范围；无现行规则覆盖。 |
| `validation_failed` | 引用、输出结构、承接约束或保存失败；不移动原文水位。 |
| `workspace_verified` | workspace_root/task_id 已幂等建立、owner manifest 匹配；碰撞或不可写则不 ACTIVE。 |
