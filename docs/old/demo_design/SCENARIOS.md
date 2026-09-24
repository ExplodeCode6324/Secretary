> 历史归档：设计阶段的原始设计或早期实现说明，和当前代码不构成证据对应。命令、路径与结论仅供历史追溯；当前入口见 [项目文档](../../README.md)。

# 跨模块流程与验收场景

以下步骤引用 canonical 状态机，不重新定义状态。实现验收应检查真正的持久化记录及副作用次数；本包里的图/契约检查不能代替这些运行验收。

## 1. 新输入与长 loop

Master 输入 A → 同帧保存原文、Input A ACCEPTED、receipt → Host 恢复后认领 A → 保存 Context/ModelCall → 请求模型。期间输入 B 以新 Input ACCEPTED 保存，不能清除或并入已发送 Context。A 的工具返回保存到本轮，A 处理完仅将 A 设 HANDLED。Host 从 durable inbox 发现 B，再创建下一 loop。通知独立于输入处理。

故障检查：在 ACK 前/后分别杀进程；ACK 后 A/B 都不能丢。发送请求后中断可重新生成模型响应，但不能重做已保存的工具作用。模型部分流不产生操作。

## 2. 异步整理与容量阻塞

从已处理的完整消息片段建立 CompactionJob QUEUED，固定 base_revision/source_event_ids → SUMMARIZING → VALIDATING。新输入和新原文继续保存。CAS 成功提交 Consciousness 与 covered 集合，只有被确认承接的原文可不再装入后续 Context。base 不符则 STALE；失败仍带原文。未承接材料无法装下时 Host CAPACITY_BLOCKED，UI 授权和 Scheduler 继续工作。

故障检查：部分覆盖不移除未覆盖原文；缺工具返回的片段不可整理掉；commit 前崩溃不丢原文；commit 后重建能找到摘要和所有原始日志。

## 3. 任务提案、初始化与执行

task_propose → 验证提案/程序登记/参数 → TaskPlan INITIALIZING 与 receipt → 创建 task_id 目录/manifest → ACTIVE。触发产生唯一 occurrence_key/Execution CREATED；检查登记前提 → READY；保存 Dispatch 与 DISPATCHING → worker 登记 → RUNNING。

即时 AGENT 任务可接着拉起 agent；定时任务先建目录，执行条件满足才启用执行者。无工作时无需保活 agent。PROGRAM 使用同一初始化和调度流程，不必额外创建 agent。

故障检查：初始化失败不生成第二 task_id；分派记录已写但进程启动回执丢失时，先核对原 attempt；无法确认则 RESULT_UNKNOWN。周期遗漏按约定处理，不批量补跑所有历史。

## 4. 等待授权与普通决定

受控工具保存 Operation PREPARED。有效持续规则覆盖则 AUTHORIZED；否则 WAIT_AUTH 并创建 AuthorizationRequest PENDING，直接呈现 UI。Master UI 点击匹配 display_hash 的请求 → APPROVED。最后 gate 再核验 scope/参数/状态/版本 → 同帧消费批准与 Operation DISPATCHED → 执行 → 保存回执。

缺少普通业务选择时创建 DecisionRequest OPEN，Scheduler 保持 WAIT_DECISION，可保存 context 后释放 worker。主会话读结构化问题给普通回答 → ANSWERED → 原执行 READY → 核对旧 worker 已停止后重新分派或接回原 worker。授权请求也可以这样等待，但普通决定永不转化成批准。

故障检查：主会话停止仍可批准；重复点击只得旧回执；参数变化旧批准不可用；grant 消费后进程崩溃先核验效果；恢复的新 worker 不从 context 提取批准。到期/撤销在最终 gate 前生效。

## 5. 完成、反馈、查询与后续

原始 context/程序日志/证据先写 objects+journal → TaskResult 和终结 Execution 同帧可见 → 按约定创建 Feedback → 与 Input ACCEPTED 同帧交接。主会话立即 task_query DETAIL 应读到相同 execution 的完整材料，按需决定通知 Master。

有效 DETAIL 刷新 last_activity_at；列表不刷新。后续任务必须使用新 execution_id，可引用旧 checkpoint；旧执行的 pending_followup_ids 阻止提前退休，后续工作结束后解除关联保留，重新从该完成时刻计算活动窗口。原执行终态不变。无待处理且超过候选 TTL 后验证 ArchiveManifest，提交 RETIRED；后续短期查询返回历史引用，历史原件仍可读。

故障检查：结果/反馈交接中崩溃不出现“有结论没详情”；详情读取与退休竞争采用同一 writer；RETIRED 之后不能靠 touch 复活；未处理反馈、待决定、未知操作不能退休。

## 6. 取消、失败与结果未知

RUNNING 取消 → CANCEL_REQUESTED，实际停止且作用已知才 CANCELLED。任务可能在取消前已成功，则记录 SUCCEEDED 和取消未阻止事实。操作超时/失联 → RESULT_UNKNOWN，保留 intent/原参数/证据，核验只能查询已有结果，不发重复作用。

核验结果确为失败且 effect=NOT_APPLIED，安全规则允许时，创建 retry_of 的新 Operation；每个外部尝试仍过 gate。已完成执行要重试形成新 execution；正在进行的同一执行可以处理新操作。部分作用或无法查明时不能重复整个动作。

故障检查：针对同业务 intent 更换 operation_id 也不能绕过 unknown；重启不自动执行历史工具；cancel 返回不意味着进程退出。运行中的 deadline 也走取消/核验，不能直接假定 EXPIRED。

## 7. World Model 冲突与提交恢复

memory_propose_change → 验证对象/来源/谓词/证据 → WorldCommand RECEIVED → 统一授权 → APPLYING。PG 锁 change_id 与 slot，校验 expected_revision，在同一事务保存主张/状态/receipt/outbox。并发更正过期版本返回 CONFLICT，不覆盖。知识分歧作为多个 CONTESTED 主张保存，与写版本 CONFLICT 是两个概念。

PG COMMIT 后断线：按 change_id 查 receipt。存在则只补 JSON 交接；不存在则按同 change_id 串行事务再次核对，原事务若仍运行须等其同键锁结束。这里仅复原同一已授权数据库写，不创建新作用、不重新消费一次批准。拿到 receipt 的 outcome 决定 COMMITTED/CONFLICT/REJECTED。

故障检查：同 change_id 改 payload 拒绝；journal 已保存、outbox 未标 exported 时不重复事件；新候选不能无声替换原事实；缺来源、缺证据、OBSERVED 缺 observed_at 不能成功。完整证据字节在 JSON object store，PG JSONB 不用于原 context 的字节复载。

## 8. 进程退出与整机重启

主会话 worker 退出不改 logical session_id。全部应用重启时：独占 owner lock → 校验 journal 与对象 → epoch 更新 → 核对 PG receipt/outbox → 核对 worker/外部操作 → 恢复已认领 loop 和未处理输入 → 恢复计划调度。缺原始 context 或日志中段损坏则 RECOVERY_BLOCKED，不能创建空白状态继续。

故障检查：旧 epoch worker 的新执行请求拒绝；旧回执可作为核验材料；共享 workspace 中前次 execution 的原件不能被新执行覆盖；模型 adapter 不兼容则阻塞载入并明确原因。
