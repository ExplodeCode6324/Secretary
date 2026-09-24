> 历史归档：设计阶段的原始设计或早期实现说明，和当前代码不构成证据对应。命令、路径与结论仅供历史追溯；当前入口见 [项目文档](../../README.md)。

# 状态转换测试矩阵

从 canonical catalog 生成 **14 组状态机、131 条转换、524 个基础子项义务**。尚未实现应用测试驱动，全部 NOT_RUN；多条件守卫逐条件反例会进一步增加执行数。

每行均执行以下四项，具体准备使用 [场景用例](COVERAGE.md) 与 [守卫定义](../state_machine/GUARDS.md)：

1. positive：通过合法入口建立 from，满足 guard，发送 event，确认 to 及 commit 的领域内容已可靠保存，独立核对副作用。
2. guard_negative：除被破坏的一个 guard 条件外均有效；发送同 event，不得非法提交本边。故障本身允许驱动其他明确的失败边，必须记录，不把失败诊断当违规。
3. commit_failure_recovery：提交前/后注入相应故障，新进程重开；恢复到可靠前态或后态，未知作用保留，不半提交或重放动作。纯读/无新提交子项说明 N/A 原因。
4. redelivery：同事件身份重复交付；命令返回旧回执或明确拒绝过时事件，定时/内部事件按对应去重键处理；不重复外部作用或非法迁移。

同状态自环也必须检验 revision/事件/实际作用；纯状态值相同不是通过。未实现 fixture/入口/故障钩子的行记 BLOCKED_CAPABILITY，不因为图中有这条边就记 PASS。

| 义务 ID | from → event → to | guard | 正向提交内容 |
| --- | --- | --- | --- |
| TR-Host-01 | STOPPED → wake → RECOVERING | `exclusive_owner` | 复用应用持有的独占锁和 owner_epoch；仅应用重新取得所有权时递增 epoch |
| TR-Host-02 | RECOVERING → valid → IDLE | `recovery_complete` | 重放 journal；核对中断操作 |
| TR-Host-03 | RECOVERING → invalid → RECOVERY_BLOCKED | `missing_or_corrupt` | 保存恢复故障；不创建空会话 |
| TR-Host-04 | RECOVERY_BLOCKED → repair → RECOVERING | `operator_repaired` | 重新验证完整记录 |
| TR-Host-05 | IDLE → input → RUNNING | `pending_input_and_capacity` | 原子认领输入并创建 loop_id |
| TR-Host-06 | RUNNING → input → RUNNING | `valid_new_input` | 只追加可靠 inbox，不并发 loop |
| TR-Host-07 | RUNNING → next_call → RUNNING | `call_checkpoint_safe` | 保存本轮调用和工具交互 |
| TR-Host-08 | RUNNING → done → IDLE | `loop_effects_recorded` | 输入标 HANDLED；未认领输入不清空 |
| TR-Host-09 | RUNNING → full → CAPACITY_BLOCKED | `cannot_fit_context` | 保留原文和本轮进度 |
| TR-Host-10 | CAPACITY_BLOCKED → compacted → RUNNING | `context_fits` | 已有 loop 从持久化调用边界继续；尚无认领批次则原子认领待输入再调用 |
| TR-Host-11 | IDLE → shutdown → DRAINING | `no_active_loop` | 停止新调用 |
| TR-Host-12 | RUNNING → shutdown → DRAINING | `checkpoint_requested` | 等待安全交互边界 |
| TR-Host-13 | CAPACITY_BLOCKED → shutdown → DRAINING | `checkpoint_saved` | 保存未完成 loop |
| TR-Host-14 | DRAINING → saved → STOPPED | `all_owned_state_durable` | 退出模型宿主；Scheduler 可继续运行 |
| TR-Host-15 | RECOVERING → resume_loop → RUNNING | `same_loop_checkpoint` | 恢复已认领 loop；只处理尚未完成交互 |
| TR-Host-16 | IDLE → full → CAPACITY_BLOCKED | `cannot_fit_context` | 待输入仍 ACCEPTED，保留准备中的 loop 标识 |
| TR-Input-01 | ACCEPTED → claim → CLAIMED | `single_loop` | 保存 loop_id |
| TR-Input-02 | CLAIMED → processed → HANDLED | `response_and_effects_durable` | 提交本批输入处理回执 |
| TR-Input-03 | CLAIMED → recover → CLAIMED | `same_loop_checkpoint` | 续接同一 loop，禁止重新从头执行工具 |
| TR-Call-01 | PREPARED → send → IN_FLIGHT | `context_durable` | 记录发送意图 |
| TR-Call-02 | IN_FLIGHT → response → RESPONSE_SAVED | `complete_response` | 保存完整原始响应 |
| TR-Call-03 | IN_FLIGHT → lost → INTERRUPTED | `no_complete_response` | 不执行部分输出 |
| TR-Call-04 | INTERRUPTED → retry → PREPARED | `no_tools_from_partial` | 同 context 新 transport_attempt；不重放工具 |
| TR-Call-05 | IN_FLIGHT → error → FAILED | `definitive_error` | 保存明确失败 |
| TR-Compaction-01 | QUEUED → start → SUMMARIZING | `one_job_and_fixed_source` | 固定 base_revision 和原文引用 |
| TR-Compaction-02 | SUMMARIZING → response → VALIDATING | `complete_response` | 保存候选摘要 |
| TR-Compaction-03 | SUMMARIZING → error → FAILED | `known_failure` | 原文保留 |
| TR-Compaction-04 | VALIDATING → commit → COMMITTED | `base_and_coverage_valid` | 一次事务保存新 Consciousness 与承接集合 |
| TR-Compaction-05 | VALIDATING → stale → STALE | `base_changed` | 保留原文，后续新 job |
| TR-Compaction-06 | VALIDATING → invalid → FAILED | `validation_failed` | 保留原文 |
| TR-Compaction-07 | SUMMARIZING → interrupted → FAILED | `no_complete_response` | 保留原文；重新建立固定范围 job |
| TR-Plan-01 | INITIALIZING → workspace_ready → ACTIVE | `workspace_verified` | 目录就绪；可供触发 |
| TR-Plan-02 | INITIALIZING → init_error → INIT_FAILED | `known_error` | 记录目录错误 |
| TR-Plan-03 | INIT_FAILED → retry_init → INITIALIZING | `same_task_id` | 不分配第二个任务 |
| TR-Plan-04 | ACTIVE → pause → PAUSED | `control_authorized` | 停止新增触发分派 |
| TR-Plan-05 | PAUSED → resume → ACTIVE | `control_authorized` | 恢复触发 |
| TR-Plan-06 | ACTIVE → close → CLOSED | `no_future_occurrence` | 关闭计划；不改写执行 |
| TR-Plan-07 | PAUSED → close → CLOSED | `control_authorized` | 关闭计划 |
| TR-Plan-08 | INITIALIZING → close → CLOSED | `control_authorized` | 停止初始化并关闭计划；已产生目录留存归属记录 |
| TR-Plan-09 | INIT_FAILED → close → CLOSED | `control_authorized` | 关闭不再重试的初始化失败计划 |
| TR-Execution-01 | CREATED → check → WAIT_PRECONDITION | `trigger_due` | 保存前提检查 |
| TR-Execution-02 | WAIT_PRECONDITION → ready → READY | `preconditions_met` | 清除可恢复等待 |
| TR-Execution-03 | READY → dispatch → DISPATCHING | `enabled_revision_and_no_overlap` | 保存 Dispatch 与 attempt_id |
| TR-Execution-04 | DISPATCHING → worker_started → RUNNING | `matching_epoch_attempt` | 关联 worker |
| TR-Execution-05 | DISPATCHING → spawn_failed → FAILED | `definite_not_started` | 保存失败结果 |
| TR-Execution-06 | RUNNING → needs_decision → WAIT_DECISION | `materials_saved` | 持有 DecisionRequest |
| TR-Execution-07 | WAIT_DECISION → decided → READY | `valid_decision_and_conditions` | 保存普通决定 |
| TR-Execution-08 | RUNNING → needs_auth → WAIT_AUTH | `operation_prepared` | 持有 AuthorizationRequest |
| TR-Execution-09 | WAIT_AUTH → authorized → READY | `grant_current` | 待执行操作仍须最终 gate |
| TR-Execution-10 | WAIT_AUTH → refused → FAILED | `task_cannot_continue` | 保存拒绝结果 |
| TR-Execution-11 | RUNNING → success → SUCCEEDED | `result_and_evidence_saved` | 结果已可查再创建反馈 |
| TR-Execution-12 | RUNNING → failure → FAILED | `known_failed` | 保存已知影响 |
| TR-Execution-13 | RUNNING → uncertain → RESULT_UNKNOWN | `missing_effect_result` | 停止相关操作并反馈 |
| TR-Execution-14 | DISPATCHING → lost → RESULT_UNKNOWN | `may_have_started` | 先查 worker/receipt |
| TR-Execution-15 | RESULT_UNKNOWN → verified_success → SUCCEEDED | `new_evidence` | 记录核验依据 |
| TR-Execution-16 | RESULT_UNKNOWN → verified_failure → FAILED | `new_evidence` | 不自动重试 |
| TR-Execution-17 | RESULT_UNKNOWN → found_running → RUNNING | `identity_verified` | 接回原 worker，不新起重复者 |
| TR-Execution-18 | CANCEL_REQUESTED → stopped → CANCELLED | `stop_and_effects_known` | 保存停止证据 |
| TR-Execution-19 | CANCEL_REQUESTED → uncertain → RESULT_UNKNOWN | `effects_unknown` | 保留取消意图 |
| TR-Execution-20 | CANCEL_REQUESTED → completed_before_cancel → SUCCEEDED | `completion_proven` | 报告取消未阻止完成 |
| TR-Execution-21 | CREATED → cancel → CANCELLED | `no_inflight_effect` | 未开始的相关操作取消 |
| TR-Execution-22 | CREATED → deadline → EXPIRED | `deadline_elapsed_and_no_inflight` | 到期结束；无期限不自行过期 |
| TR-Execution-23 | WAIT_PRECONDITION → cancel → CANCELLED | `no_inflight_effect` | 未开始的相关操作取消 |
| TR-Execution-24 | WAIT_PRECONDITION → deadline → EXPIRED | `deadline_elapsed_and_no_inflight` | 到期结束；无期限不自行过期 |
| TR-Execution-25 | READY → cancel → CANCELLED | `no_inflight_effect` | 未开始的相关操作取消 |
| TR-Execution-26 | READY → deadline → EXPIRED | `deadline_elapsed_and_no_inflight` | 到期结束；无期限不自行过期 |
| TR-Execution-27 | WAIT_DECISION → cancel → CANCELLED | `no_inflight_effect` | 未开始的相关操作取消 |
| TR-Execution-28 | WAIT_DECISION → deadline → EXPIRED | `deadline_elapsed_and_no_inflight` | 到期结束；无期限不自行过期 |
| TR-Execution-29 | WAIT_AUTH → cancel → CANCELLED | `no_inflight_effect` | 未开始的相关操作取消 |
| TR-Execution-30 | WAIT_AUTH → deadline → EXPIRED | `deadline_elapsed_and_no_inflight` | 到期结束；无期限不自行过期 |
| TR-Execution-31 | RUNNING → cancel → CANCEL_REQUESTED | `request_valid` | 只记录请求；停止须回执 |
| TR-Execution-32 | DISPATCHING → cancel → CANCEL_REQUESTED | `request_valid` | 只记录请求；停止须回执 |
| TR-Execution-33 | READY → needs_auth → WAIT_AUTH | `operation_prepared` | 程序启动先创建受控 program.run 请求，不先启动程序 |
| TR-Execution-34 | WAIT_AUTH → needs_decision → WAIT_DECISION | `materials_saved` | 授权拒绝后请求普通方案选择，不能把选择变批准 |
| TR-Execution-35 | RUNNING → deadline → CANCEL_REQUESTED | `deadline_elapsed` | 保存到期原因，等待实际停止 |
| TR-Execution-36 | DISPATCHING → deadline → CANCEL_REQUESTED | `deadline_elapsed` | 先核实分派，不把超时当未发生 |
| TR-Retention-01 | HOT → access → HOT | `targeted_detail_or_followup` | 刷新 last_activity_at，列表不刷新 |
| TR-Retention-02 | HOT → idle → ARCHIVE_PENDING | `terminal_no_pending_and_ttl` | 冻结退出候选 |
| TR-Retention-03 | ARCHIVE_PENDING → access → HOT | `before_retirement_commit` | 撤销退出候选并刷新 |
| TR-Retention-04 | ARCHIVE_PENDING → archive_verified → RETIRED | `logs_objects_durable_and_no_pending` | 移除短期查询能力；保留索引墓碑 |
| TR-Operation-01 | PREPARED → covered → AUTHORIZED | `rule_matches` | 保存规则版本与范围 |
| TR-Operation-02 | PREPARED → request → WAIT_AUTH | `valid_not_covered` | 生成授权请求 |
| TR-Operation-03 | WAIT_AUTH → approve → AUTHORIZED | `master_ui_valid` | 绑定 grant |
| TR-Operation-04 | WAIT_AUTH → deny → CANCELLED | `master_reject_or_expire` | 无执行 |
| TR-Operation-05 | AUTHORIZED → execute → DISPATCHED | `final_gate` | 一次提交 consume grant + dispatch intent |
| TR-Operation-06 | AUTHORIZED → stale → WAIT_AUTH | `grant_or_target_changed` | 原 grant 不再适用 |
| TR-Operation-07 | DISPATCHED → success → SUCCEEDED | `durable_receipt` | 结果与证据留存 |
| TR-Operation-08 | DISPATCHED → failure → FAILED | `known_effects` | 保存实际影响 |
| TR-Operation-09 | DISPATCHED → lost → RESULT_UNKNOWN | `outcome_unknown` | 禁止重做 |
| TR-Operation-10 | RESULT_UNKNOWN → verify_success → SUCCEEDED | `evidence` | 只补证据 |
| TR-Operation-11 | RESULT_UNKNOWN → verify_failure → FAILED | `evidence` | 新重试须新操作且符合安全规则 |
| TR-Operation-12 | PREPARED → cancel → CANCELLED | `no_inflight_effect` | 未分派；撤下批准请求或使批准不可消费 |
| TR-Operation-13 | WAIT_AUTH → cancel → CANCELLED | `no_inflight_effect` | 未分派；撤下批准请求或使批准不可消费 |
| TR-Operation-14 | AUTHORIZED → cancel → CANCELLED | `no_inflight_effect` | 未分派；撤下批准请求或使批准不可消费 |
| TR-Authorization-01 | PENDING → approve → APPROVED | `master_ui_and_scope_match` | 持久化批准 |
| TR-Authorization-02 | PENDING → reject → REJECTED | `master_ui` | 持久化拒绝 |
| TR-Authorization-03 | PENDING → expire → EXPIRED | `deadline_elapsed` | 撤下有效请求 |
| TR-Authorization-04 | APPROVED → revoke → REVOKED | `master_ui` | 阻止未分派操作 |
| TR-Authorization-05 | APPROVED → expire → EXPIRED | `deadline_elapsed` | 禁止消费 |
| TR-Authorization-06 | APPROVED → consume → CONSUMED | `final_gate` | 与 Operation.DISPATCHED 同事务 |
| TR-Authorization-07 | PENDING → withdraw → REVOKED | `scope_changed` | 操作取消或对象改变，请求作废 |
| TR-Decision-01 | OPEN → answer → ANSWERED | `request_revision_matches` | 保存普通工作决定 |
| TR-Decision-02 | OPEN → changed → OBSOLETE | `scope_changed` | 不沿用旧回复 |
| TR-Decision-03 | OPEN → expire → EXPIRED | `explicit_deadline` | 没有回复不表示同意 |
| TR-Feedback-01 | QUEUED → accept_input → DELIVERED | `details_durable` | 与 Input.ACCEPTED 同事务；按 feedback_id 去重 |
| TR-Feedback-02 | DELIVERED → processed → HANDLED | `loop_handled` | 记录主会话已处理 |
| TR-Notification-01 | QUEUED → send → SENDING | `channel_ready` | 持久化发送意图 |
| TR-Notification-02 | SENDING → receipt → SENT | `delivery_receipt` | 不等于已读 |
| TR-Notification-03 | SENDING → reject → FAILED | `definite_not_sent` | 记录失败 |
| TR-Notification-04 | SENDING → lost → DELIVERY_UNKNOWN | `may_have_sent` | 先查询渠道，不盲目重发 |
| TR-Notification-05 | DELIVERY_UNKNOWN → verified → SENT | `channel_evidence` | 补投递回执 |
| TR-Notification-06 | DELIVERY_UNKNOWN → not_sent → FAILED | `channel_evidence` | 新发送由主会话决定 |
| TR-WorldCommand-01 | RECEIVED → valid → WAIT_AUTH | `registered_predicate_and_provenance` | 请求统一授权 |
| TR-WorldCommand-02 | RECEIVED → invalid → REJECTED | `invalid_payload` | 记录原因 |
| TR-WorldCommand-03 | WAIT_AUTH → covered → READY | `valid_grant_or_rule` | 保存授权引用 |
| TR-WorldCommand-04 | WAIT_AUTH → denied → REJECTED | `denied` | 不写 PG |
| TR-WorldCommand-05 | READY → apply → APPLYING | `final_gate` | 保留稳定 change_id |
| TR-WorldCommand-06 | APPLYING → committed → COMMITTED | `pg_receipt_exists` | 从 PG receipt 补日志 |
| TR-WorldCommand-07 | APPLYING → conflict → CONFLICT | `revision_mismatch` | 保存冲突，重新提案使用新 change_id |
| TR-WorldCommand-08 | APPLYING → disconnected → RETRYABLE_ERROR | `unknown_pg_commit` | 先查同 change_id receipt |
| TR-WorldCommand-09 | RETRYABLE_ERROR → receipt_found → COMMITTED | `hash_matches` | 不重复写事实 |
| TR-WorldCommand-10 | RETRYABLE_ERROR → receipt_absent → APPLYING | `pg_reachable_and_no_receipt` | 仅补做同一已分派 PG 事务，不重新消费批准 |
| TR-WorldCommand-11 | RETRYABLE_ERROR → conflict_found → CONFLICT | `pg_receipt_exists` | 复用 PG 的 CONFLICT receipt |
| TR-WorldCommand-12 | RETRYABLE_ERROR → rejection_found → REJECTED | `pg_receipt_exists` | 复用 PG 的 REJECTED receipt |
| TR-WorldCommand-13 | APPLYING → rejected → REJECTED | `pg_receipt_exists` | 事务内业务校验拒绝 |
| TR-Program-01 | REGISTERED → enable → ENABLED | `human_validated` | 固化登记 revision 和代码摘要 |
| TR-Program-02 | ENABLED → disable → DISABLED | `human_control` | 停止新分派，运行者不自动停止 |
| TR-Program-03 | DISABLED → enable → ENABLED | `human_validated` | 重新启用 |
| TR-Program-04 | ENABLED → update → ENABLED | `human_validated` | 新 revision；分派前再检查 |
| TR-Program-05 | DISABLED → update → DISABLED | `human_validated` | 新 revision 保持禁用 |
| TR-Program-06 | REGISTERED → update → REGISTERED | `human_validated` | 人工修订未启用的登记版本 |
