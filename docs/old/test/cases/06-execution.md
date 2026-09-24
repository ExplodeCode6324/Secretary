> 历史归档：设计阶段的原始设计或早期实现说明，和当前代码不构成证据对应。命令、路径与结论仅供历史追溯；当前入口见 [项目文档](../../../README.md)。

# 执行、反馈、接续与通知

由 [catalog.json](../catalog.json) 生成；修改唯一来源后运行 `python3 test/scripts/build.py`。

通用隔离设施、竞态排序和判定规则见 [执行协议](../PROTOCOL.md)。每个子情况独立执行和记录。evidence_level 是目标证据类型，不代表已经取得；真实模型场景中的确定性持久化子项可先以 OFFLINE_RUNTIME 单独报告。

<a id="exe-001"></a>
## EXE-001 任务交接材料不丢约束

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.5, 5.6, 5.8；语义约束 J03, J06, J14。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[Feedback.md](../../state_machine/Feedback.md)、[Retention.md](../../state_machine/Retention.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：AGENT 提案含目标、材料、编号验收条件和禁止修改约束。

步骤：

1. 初始化分派。
2. 检查实际 task prompt。
3. 等决定后换新 worker 继续。

预期与禁止结果：

- task/execution 归属正确。
- 目标/约束/材料/验收完整。
- 恢复仍带原限制与新决定。
- 主会话不亲自执行。

证据：提案与实际 prompt；checkpoint；工具集合。

<a id="exe-002"></a>
## EXE-002 普通决定精确关联与幂等

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.5, 5.6, 5.8；语义约束 J18, J02。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[Feedback.md](../../state_machine/Feedback.md)、[Retention.md](../../state_machine/Retention.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：两个 execution 各一个 OPEN 决定。

步骤：

1. 答复无明确关联。
2. 答错 execution。
3. 重复同 answer_request_id。
4. 并发两个不同回答。

预期与禁止结果：

- 不批量套用同意。
- 只处理指定有效 revision。
- 重复返回原结果。
- 答复与原执行 READY 原子。
- 无回复不推进。

证据：DecisionRequest；命令回执；READY 帧。

<a id="exe-003"></a>
## EXE-003 决定失效及任务范围变化

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.5, 5.6, 5.8；语义约束 J18, J12。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[Feedback.md](../../state_machine/Feedback.md)、[Retention.md](../../state_machine/Retention.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：等待决定的目标/条件随后实质改变。

步骤：

1. 旧回答延迟到达。
2. 超过显式时限。
3. 提出扩大范围的新方案。

预期与禁止结果：

- 旧问题 OBSOLETE/EXPIRED 后不可沿用。
- 新范围按新任务及授权处理。
- 旧记录保留。

证据：问题版本；scope；拒绝原因。

<a id="exe-004"></a>
## EXE-004 worker 回执身份与乱序

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.5, 5.6, 5.8；语义约束 J09。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[Feedback.md](../../state_machine/Feedback.md)、[Retention.md](../../state_machine/Retention.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：同 task 两 execution/attempt，旧 worker 尚存。

步骤：

1. 投递错 task、错 attempt、旧 epoch、重复及迟到 receipt。
2. 正确 receipt 最后到达。

预期与禁止结果：

- 不得覆盖新执行控制状态。
- 可保留真实迟到证据供核验。
- 正确同身份回执幂等。

证据：回执原件；控制状态版本；审计。

<a id="exe-005"></a>
## EXE-005 已生效但回执丢失

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.5, 5.6, 5.8；语义约束 J15。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[Feedback.md](../../state_machine/Feedback.md)、[Retention.md](../../state_machine/Retention.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：合成外部接收器一次写入已发生。

步骤：

1. F06 丢回执。
2. 超时。
3. 重启。
4. 模型改 operation_id 或新提案试图重做同业务作用。

预期与禁止结果：

- RESULT_UNKNOWN 并反馈。
- 原 intent 不重派。
- 新 ID 不绕过。
- 独立 Master 新工作仍可推进。

证据：effect ledger；拒绝日志；UNKNOWN 引用。

<a id="exe-006"></a>
## EXE-006 明确未生效失败的有限重试

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.5, 5.6, 5.8；语义约束 J15, J13。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[Feedback.md](../../state_machine/Feedback.md)、[Retention.md](../../state_machine/Retention.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：接收器证明 NOT_APPLIED，SafetyRule 限定次数及范围。

步骤：

1. 第一次确定失败。
2. 按规则 retry_of 新操作。
3. 超过次数。
4. 另返回部分已生效。

预期与禁止结果：

- 只在确证未生效且规则允许时重试并重新 gate。
- 超预算停止。
- 部分作用不可重跑整个动作。

证据：effect 字段；retry_of 链；尝试次数。

<a id="exe-007"></a>
## EXE-007 串行工具批次中途等待

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.5, 5.6, 5.8；语义约束 J13, J15。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[Feedback.md](../../state_machine/Feedback.md)、[Retention.md](../../state_machine/Retention.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：模型单次响应含两个写工具，第一个需授权。

步骤：

1. 第一个 WAIT_AUTH/拒绝/UNKNOWN 三子情况。
2. 观察第二个工具。

预期与禁止结果：

- 后续工具不越过第一项未决。
- 恢复完成原调用后才按协议继续。
- 不能半响应触发。

证据：tool_call_id 顺序；操作状态；账本。

<a id="exe-008"></a>
## EXE-008 程序协议输出与取消

P1 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.5, 5.6, 5.8；语义约束 J19, J14, J16。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[Feedback.md](../../state_machine/Feedback.md)、[Retention.md](../../state_machine/Retention.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：程序 fixture 支持有效/畸形 JSON、非零退出、巨大 stdout/stderr、挂起。

步骤：

1. 分别运行。
2. 限制输出入口与持续落盘。
3. 取消进程组。
4. 尝试不支持的 resume。

预期与禁止结果：

- 完整原始流有序保存或明确资源限制。
- 畸形结果不冒称成功。
- 不能确定作用时 UNKNOWN。
- 不支持恢复明确反馈。

证据：stdout/stderr 原件；exit/signal；program digest。

<a id="exe-009"></a>
## EXE-009 结果先于反馈与独立验收

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.5, 5.6, 5.8；语义约束 J11, J16。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[Feedback.md](../../state_machine/Feedback.md)、[Retention.md](../../state_machine/Retention.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：任务结果含真实产物，另有只说完成/假路径/缺验收结果的候选。

步骤：

1. F07 保存中断。
2. 接收反馈立即查询指定 execution。
3. 独立验证产物内容。

预期与禁止结果：

- 结论可见时详情已可查。
- 无产物/不完整自评不报完成。
- 语义目标由独立 verifier 判定，不只看自评。

证据：TaskResult/Artifact hash；查询；独立测试结果。

<a id="exe-010"></a>
## EXE-010 反馈重投与处理确认

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.5, 5.6, 5.8；语义约束 J01, J11。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[Feedback.md](../../state_machine/Feedback.md)、[Retention.md](../../state_machine/Retention.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：QUEUED feedback，宿主可在 F08 中断。

步骤：

1. 投递并丢交接 ACK。
2. 重投。
3. 让 Input CLAIMED 但 loop 未完成。
4. 最后完成。

预期与禁止结果：

- 同 feedback 对应一个 Input。
- DELIVERED 不等于 HANDLED。
- 仅完成关联 loop 后 HANDLED。

证据：feedback/input/loop 关联；事务；处理次数。

<a id="exe-011"></a>
## EXE-011 周期反馈筛选与迟到反馈

P1 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.5, 5.6, 5.8；语义约束 J09, J11。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[Feedback.md](../../state_machine/Feedback.md)、[Retention.md](../../state_machine/Retention.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：周期无变化、重要变化、异常及两轮 execution。

步骤：

1. 输出大量重复进度。
2. 反序交付两轮结果。
3. 从旧反馈读详情。

预期与禁止结果：

- 无变化按策略只记日志。
- 阻塞/UNKNOWN 必报。
- 旧反馈指旧 execution 不返回最新一轮。
- 不倒退当前状态。

证据：策略；反馈次数；详情 execution ID。

<a id="exe-012"></a>
## EXE-012 完整 checkpoint 与释放资源

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.5, 5.6, 5.8；语义约束 J14, J21。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[Feedback.md](../../state_machine/Feedback.md)、[Retention.md](../../state_machine/Retention.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：AGENT 等待决定；PROGRAM 支持/不支持 resume 各一项。

步骤：

1. 保存 context/接续说明/产物/未知影响。
2. 释放 worker。
3. 新实例接续。

预期与禁止结果：

- 材料独立于进程存活且可读。
- 旧工具不重放。
- 程序只按明确 resume 能力继续。
- 缺材料不释放后假称可恢复。

证据：Checkpoint；raw bytes；进程记录；resume 原件。

<a id="exe-013"></a>
## EXE-013 终态后续执行与同计划复用

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.5, 5.6, 5.8；语义约束 J10, J14。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[Feedback.md](../../state_machine/Feedback.md)、[Retention.md](../../state_machine/Retention.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：已终结但未 RETIRED 的父执行，活动周期计划。

步骤：

1. 同目标 reuse_task_id。
2. 实质改目标。
3. 无 parent。
4. 已 CLOSED 计划。
5. 重复提案。

预期与禁止结果：

- 合法复用新 execution/IMMEDIATE request occurrence 且不改周期表。
- 旧终态不变。
- 非法复用拒绝或新计划。
- 幂等单次。

证据：parent/continuation IDs；计划时间表；终态快照。

<a id="exe-014"></a>
## EXE-014 TTL 正确起点与回收阻挡

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.5, 5.6, 5.8；语义约束 J10, J16。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[Feedback.md](../../state_machine/Feedback.md)、[Retention.md](../../state_machine/Retention.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：终态已处理反馈，候选 TTL；另有待决定/授权/未知/未处理反馈/后续工作。

步骤：

1. 到 TTL 前/等于/后扫描。
2. DETAIL 与 LIST/日志/健康查询。
3. 结束后续工作。

预期与禁止结果：

- 仅有效详情刷新。
- 任何 pending 阻挡退休。
- 后续结束解除阻挡并刷新。
- 48h 仅读取配置不写死。

证据：last_activity/ended_at；pending refs；retention 状态。

<a id="exe-015"></a>
## EXE-015 详情或后续任务与退休竞争

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.5, 5.6, 5.8；语义约束 J10, J02。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[Feedback.md](../../state_machine/Feedback.md)、[Retention.md](../../state_machine/Retention.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：ARCHIVE_PENDING 且档案可验证。

步骤：

1. F12 前后并发 DETAIL/接受后续任务。
2. 三种次序。
3. 归档对象缺失子情况。

预期与禁止结果：

- 提交退休前可阻止并回 HOT。
- 退休后返回历史入口不可复活。
- 档案不完整不 RETIRED。
- 后续关联原子。

证据：revision 次序；ArchiveManifest；返回码/历史引用。

<a id="exe-016"></a>
## EXE-016 退休仍保留原始历史

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.5, 5.6, 5.8；语义约束 J10, J16, J21。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[Feedback.md](../../state_machine/Feedback.md)、[Retention.md](../../state_machine/Retention.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：完整 MAIN/TASK/SYSTEM 原件与已退休 execution。

步骤：

1. 释放进程/清理热索引。
2. memory_read 按 execution 引用读历史。
3. 提出新任务。

预期与禁止结果：

- Context、stdout/stderr、证据原件仍在。
- 旧执行不重激活。
- 新任务独立身份引用历史。

证据：对象 hash；日志检索；新 task ID。

<a id="exe-017"></a>
## EXE-017 通知投递未知与已读区别

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.5, 5.6, 5.8；语义约束 J20。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[Feedback.md](../../state_machine/Feedback.md)、[Retention.md](../../state_machine/Retention.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：FakeChannel 已接收但可丢失 receipt。

步骤：

1. F13 中断。
2. 重投 request。
3. 只读查询渠道。
4. 另测明确未发。

预期与禁止结果：

- DELIVERY_UNKNOWN 不盲重发。
- 同 delivery_key 幂等。
- 证据确认才 SENT/FAILED。
- SENT 不等于 Master 已读/同意。

证据：channel ledger；receipt；UI 文案与状态。

<a id="exe-018"></a>
## EXE-018 反馈处理后无需必发通知

P1 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.5, 5.6, 5.8；语义约束 J11, J20。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[Feedback.md](../../state_machine/Feedback.md)、[Retention.md](../../state_machine/Retention.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：主会话收到低优先级已处理反馈；另有待决定问题。

步骤：

1. 模型选择不通知。
2. 另一个问题发提醒但 Master 无回复。

预期与禁止结果：

- 反馈可 HANDLED 且无 Notification。
- 已发送提醒不自动 ANSWERED。
- 待决定继续持久存在。

证据：Input/Feedback；Notification；DecisionRequest。
