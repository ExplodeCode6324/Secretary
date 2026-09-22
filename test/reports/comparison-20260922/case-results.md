# 120条设计用例的本轮证据映射

FAIL 表示发现相关义务的失败反例；INCONCLUSIVE 表示只有部分通过证据，整条尚未验收；NOT_RUN 表示本轮无直接执行证据。关联测试适配了 demo 的内部边界，不等于照抄完整用例步骤。完整断言、未执行部分及原始日志见 [JSON](case-results.json)。

| 用例 | 场景 | Go | Pi | 已执行子项 |
|---|---|---|---|---|
| STA-001 | 输入的接受与处理分离 | INCONCLUSIVE | INCONCLUSIVE | TestMainDurableInboxDuringCall（仅已断言子项）; new input arriving during a Pi call（仅已断言子项） |
| STA-002 | 长 loop 期间多客户端输入 | INCONCLUSIVE | INCONCLUSIVE | TestMainDurableInboxDuringCall（仅已断言子项）; new input arriving during a Pi call（仅已断言子项） |
| STA-003 | 工具返回不额外唤醒 | NOT_RUN | NOT_RUN |  |
| STA-004 | 认领后中断不误认旧回复 | NOT_RUN | INCONCLUSIVE | crash after claiming a new input（仅已断言子项） |
| STA-005 | 流式半响应与畸形工具 | INCONCLUSIVE | NOT_RUN | TestResponsesKeysAndPartialResponse（仅已断言子项） |
| STA-006 | 仅宿主模型流程更换 | NOT_RUN | NOT_RUN |  |
| STA-007 | 新进程精确装入 Context | FAIL | FAIL | TestTaskApprovalRestartNoReplay（仅已断言子项）; AUD05: Context 记录不可原位修改; AUD14: Context 保存实际工具定义; separate processes restore exact Pi context（仅已断言子项） |
| STA-008 | adapter 或 profile 不兼容 | NOT_RUN | NOT_RUN |  |
| STA-009 | 状态权威冲突 | NOT_RUN | NOT_RUN |  |
| STA-010 | 状态图合法和非法迁移 | INCONCLUSIVE | FAIL | AUD06: 拒绝 Input 非法跨状态迁移 |
| STA-011 | 关闭与新输入竞争 | NOT_RUN | NOT_RUN |  |
| STA-012 | 输入大小与上下文容量区别 | INCONCLUSIVE | NOT_RUN | TestCapacityRetainsInput（仅已断言子项） |
| STA-013 | 丢失唤醒提示仍处理可靠输入 | NOT_RUN | NOT_RUN |  |
| STO-001 | ACK 前后真实崩溃矩阵 | INCONCLUSIVE | INCONCLUSIVE | TestKillAfterDurableACK（仅已断言子项）; recover an ACK after SIGKILL（仅已断言子项） |
| STO-002 | 跨对象事务与 CAS | INCONCLUSIVE | FAIL | TestRollbackCASAndMissingObject（仅已断言子项）; AUD04: 缺失引用必须在落盘前拒绝; AUD07: 拒绝不存在的 Session 引用; missing original context object blocks recovery（仅已断言子项） |
| STO-003 | 同键同字节和异字节 | INCONCLUSIVE | INCONCLUSIVE | 1000输入/2000请求，关闭后重新打开，逐条字节与状态核对; AUD15: 原始字节、同键重投、同键异内容 |
| STO-004 | 尾帧与中段损坏 | INCONCLUSIVE | FAIL | TestJournalRecoveryAndOwnership（仅已断言子项）; AUD08: 拒绝 journal 外帧未知字段; AUD09: 拒绝非法 base64; OS owner lock excludes second writer（仅已断言子项） |
| STO-005 | 不可变对象缺失或篡改 | INCONCLUSIVE | FAIL | TestRollbackCASAndMissingObject（仅已断言子项）; AUD04: 缺失引用必须在落盘前拒绝; missing original context object blocks recovery（仅已断言子项） |
| STO-006 | 派发存在但 worker 回执丢失 | INCONCLUSIVE | INCONCLUSIVE | TestUnknownCannotBeReissued（仅已断言子项）; restart reconstructs pending input and preserves unknown operation（仅已断言子项） |
| STO-007 | 第二 writer 与旧 epoch | FAIL | FAIL | TestJournalRecoveryAndOwnership（仅已断言子项）; AUD12: final gate 验证 epoch/attempt; OS owner lock excludes second writer（仅已断言子项） |
| STO-008 | 快照与 CURRENT 故障 | BLOCKED_CAPABILITY | BLOCKED_CAPABILITY | 实现文档明确未提供恢复快照；未注入CURRENT故障 |
| STO-009 | 空间满、只读、短写与 Sync 错误 | NOT_RUN | NOT_RUN |  |
| STO-010 | 跨日志段与游标 | INCONCLUSIVE | FAIL | AUD10: 拒绝全局事件序列断裂 |
| STO-011 | 一致备份与混批恢复 | NOT_RUN | NOT_RUN |  |
| STO-012 | 未知版本与迁移失败 | NOT_RUN | NOT_RUN |  |
| MEM-001 | 完整 loop 才进入整理范围 | INCONCLUSIVE | INCONCLUSIVE | TestCompactionCoverageAndCommitments; TestCompactionFailureRetainsPendingRawThenAtomicHandoff（仅已断言子项）; Consciousness compaction preserves originals（仅已断言子项） |
| MEM-002 | 摘要提交与原文交接窗口 | INCONCLUSIVE | INCONCLUSIVE | TestCompactionCoverageAndCommitments; TestCompactionFailureRetainsPendingRawThenAtomicHandoff（仅已断言子项）; Consciousness compaction preserves originals（仅已断言子项） |
| MEM-003 | 异步整理期间输入与更正 | NOT_RUN | NOT_RUN |  |
| MEM-004 | 双整理候选 CAS | NOT_RUN | NOT_RUN |  |
| MEM-005 | 部分覆盖与伪造证据 | NOT_RUN | NOT_RUN |  |
| MEM-006 | 容量阻塞时其他模块存活 | INCONCLUSIVE | NOT_RUN | TestCapacityRetainsInput（仅已断言子项） |
| MEM-007 | 四类工作记忆与事项合并 | NOT_RUN | NOT_RUN |  |
| MEM-008 | 未履行承诺长期不遗忘 | INCONCLUSIVE | INCONCLUSIVE | TestCompactionCoverageAndCommitments; TestCompactionFailureRetainsPendingRawThenAtomicHandoff（仅已断言子项）; 短记忆样本：承诺/更正/未知；没有完整长期及分支对照; Consciousness compaction preserves originals（仅已断言子项） |
| MEM-009 | 退出事项后按证据找回 | NOT_RUN | NOT_RUN |  |
| MEM-010 | 明确更正跨层传播 | INCONCLUSIVE | INCONCLUSIVE | 短记忆样本：承诺/更正/未知；没有完整长期及分支对照 |
| MEM-011 | 观测、转述、推断和未知 | INCONCLUSIVE | INCONCLUSIVE | 短记忆样本：承诺/更正/未知；没有完整长期及分支对照 |
| MEM-012 | 同名人物与数值精度 | FAIL | INCONCLUSIVE | 3次摘要后身份问题：Go丢2项；Pi本轮保留；未跑完整漂移矩阵 |
| MEM-013 | 30/90/365 日固定时间轴回放 | NOT_RUN | NOT_RUN |  |
| MEM-014 | 反复摘要的漂移与对照 | FAIL | INCONCLUSIVE | 3次摘要后身份问题：Go丢2项；Pi本轮保留；未跑完整漂移矩阵 |
| MEM-015 | 跨重启长期记忆一致 | INCONCLUSIVE | INCONCLUSIVE | 短记忆样本：承诺/更正/未知；没有完整长期及分支对照 |
| MEM-016 | 摘要模型越权及提示注入 | NOT_RUN | NOT_RUN |  |
| SCH-001 | 提案三层检查分离 | INCONCLUSIVE | INCONCLUSIVE | TestProgramRegistrationAndAuthorization（仅已断言子项）; separate role models and Scheduler packet preserve task materials and criteria（仅已断言子项） |
| SCH-002 | 初始化中断与目录碰撞 | NOT_RUN | NOT_RUN |  |
| SCH-003 | 触发去重与时间边界 | INCONCLUSIVE | INCONCLUSIVE | TestSchedulingAndUnknownPrecondition（仅已断言子项）; precondition waits stay outside idle retirement（仅已断言子项） |
| SCH-004 | 错过触发的三种策略 | INCONCLUSIVE | INCONCLUSIVE | TestSchedulingAndUnknownPrecondition（仅已断言子项）; precondition waits stay outside idle retirement（仅已断言子项） |
| SCH-005 | 同计划重叠和跨计划上限 | INCONCLUSIVE | FAIL | AUD13: 等待中的前次执行不吞 QUEUE occurrence |
| SCH-006 | 前提新鲜度、缺失与依赖 | INCONCLUSIVE | INCONCLUSIVE | TestSchedulingAndUnknownPrecondition（仅已断言子项）; precondition waits stay outside idle retirement（仅已断言子项） |
| SCH-007 | 等待期限与无人响应 | FAIL | FAIL | AUD02: 普通决定 deadline 已过 |
| SCH-008 | 取消与完成的三种竞态 | NOT_RUN | NOT_RUN |  |
| SCH-009 | 运行中 deadline | NOT_RUN | NOT_RUN |  |
| SCH-010 | 计划暂停关闭与已有实例 | NOT_RUN | NOT_RUN |  |
| SCH-011 | 程序更新禁用与分派竞争 | NOT_RUN | NOT_RUN |  |
| SCH-012 | 当前不支持的触发类型 | NOT_RUN | NOT_RUN |  |
| AUT-001 | 普通聊天和工作决定不能授权 | INCONCLUSIVE | INCONCLUSIVE | TestTerminalConversationApprovalAndResult; TestSnapshotSelectionAndFrozenApproval（仅已断言子项）; TUI requires explicit viewed approval and rejects stale displays（仅已断言子项） |
| AUT-002 | 授权 UI 独立于模型 | INCONCLUSIVE | INCONCLUSIVE | TestTerminalConversationApprovalAndResult; TestSnapshotSelectionAndFrozenApproval（仅已断言子项）; TUI requires explicit viewed approval and rejects stale displays（仅已断言子项） |
| AUT-003 | 批准绑定与旧请求重放 | INCONCLUSIVE | INCONCLUSIVE | TestTerminalConversationApprovalAndResult; TestSnapshotSelectionAndFrozenApproval（仅已断言子项）; TUI requires explicit viewed approval and rejects stale displays（仅已断言子项） |
| AUT-004 | 消费批准与实际执行原子边界 | FAIL | FAIL | AUD12: final gate 验证 epoch/attempt |
| AUT-005 | 撤销过期取消与 gate 竞争 | NOT_RUN | NOT_RUN |  |
| AUT-006 | 一次批准与持续规则区别 | NOT_RUN | NOT_RUN |  |
| AUT-007 | 资源路径规范化与 TOCTOU | INCONCLUSIVE | NOT_RUN | TestPathAndRoleBoundaries（仅已断言子项） |
| AUT-008 | 批准后目标文件变化 | INCONCLUSIVE | FAIL | AUD01: 批准后文件改变 |
| AUT-009 | 权限与事实安全规则分离 | NOT_RUN | NOT_RUN |  |
| AUT-010 | PROGRAM 启动前批准 | INCONCLUSIVE | INCONCLUSIVE | TestProgramRegistrationAndAuthorization（仅已断言子项）; program launch waits for approval, captures real process output（仅已断言子项） |
| AUT-011 | 授权合法性与待批准数量 | NOT_RUN | NOT_RUN |  |
| AUT-012 | 持续规则更新版本竞争 | NOT_RUN | NOT_RUN |  |
| EXE-001 | 任务交接材料不丢约束 | INCONCLUSIVE | INCONCLUSIVE | TestProgramRegistrationAndAuthorization（仅已断言子项）; separate role models and Scheduler packet preserve task materials and criteria（仅已断言子项） |
| EXE-002 | 普通决定精确关联与幂等 | INCONCLUSIVE | FAIL | AUD03: 相同普通决定重投 |
| EXE-003 | 决定失效及任务范围变化 | FAIL | FAIL | AUD02: 普通决定 deadline 已过 |
| EXE-004 | worker 回执身份与乱序 | NOT_RUN | NOT_RUN |  |
| EXE-005 | 已生效但回执丢失 | INCONCLUSIVE | INCONCLUSIVE | TestUnknownCannotBeReissued（仅已断言子项）; restart reconstructs pending input and preserves unknown operation（仅已断言子项） |
| EXE-006 | 明确未生效失败的有限重试 | NOT_RUN | NOT_RUN |  |
| EXE-007 | 串行工具批次中途等待 | NOT_RUN | INCONCLUSIVE | later tool in same Pi batch is stopped（仅已断言子项） |
| EXE-008 | 程序协议输出与取消 | INCONCLUSIVE | INCONCLUSIVE | TestProgramRegistrationAndAuthorization（仅已断言子项）; program launch waits for approval, captures real process output（仅已断言子项） |
| EXE-009 | 结果先于反馈与独立验收 | INCONCLUSIVE | INCONCLUSIVE | TestTaskApprovalRestartNoReplay（仅已断言子项）; plain completion text cannot mark agent task successful; incomplete criterion assessments（仅已断言子项） |
| EXE-010 | 反馈重投与处理确认 | INCONCLUSIVE | INCONCLUSIVE | TestTerminalRetentionWaitsForFeedback（仅已断言子项）; short-term retirement keeps history and blocks pending feedback（仅已断言子项） |
| EXE-011 | 周期反馈筛选与迟到反馈 | NOT_RUN | NOT_RUN |  |
| EXE-012 | 完整 checkpoint 与释放资源 | NOT_RUN | NOT_RUN |  |
| EXE-013 | 终态后续执行与同计划复用 | INCONCLUSIVE | NOT_RUN | TestSamePlanFollowupKeepsTerminalHistory（仅已断言子项） |
| EXE-014 | TTL 正确起点与回收阻挡 | INCONCLUSIVE | INCONCLUSIVE | TestTerminalRetentionWaitsForFeedback（仅已断言子项）; short-term retirement keeps history and blocks pending feedback（仅已断言子项） |
| EXE-015 | 详情或后续任务与退休竞争 | NOT_RUN | NOT_RUN |  |
| EXE-016 | 退休仍保留原始历史 | INCONCLUSIVE | INCONCLUSIVE | TestTerminalRetentionWaitsForFeedback（仅已断言子项）; short-term retirement keeps history and blocks pending feedback（仅已断言子项） |
| EXE-017 | 通知投递未知与已读区别 | INCONCLUSIVE | FAIL | AUD11: 无通道回执不得标记通知 SENT |
| EXE-018 | 反馈处理后无需必发通知 | NOT_RUN | NOT_RUN |  |
| WLD-001 | 谓词类型单位关系与证据约束 | INCONCLUSIVE | INCONCLUSIVE | 临时PG仓储/授权桥接：有限有效形状、冲突/CAS、outbox回放、change去重 |
| WLD-002 | 来源伪装和实体目录 | INCONCLUSIVE | INCONCLUSIVE | 临时PG仓储/授权桥接：有限有效形状、冲突/CAS、outbox回放、change去重 |
| WLD-003 | 新事实与等价支持 | NOT_RUN | NOT_RUN |  |
| WLD-004 | 知识冲突与写版本冲突区别 | INCONCLUSIVE | INCONCLUSIVE | 临时PG仓储/授权桥接：有限有效形状、冲突/CAS、outbox回放、change去重 |
| WLD-005 | 更正撤回及支持者处理 | NOT_RUN | NOT_RUN |  |
| WLD-006 | 跨 slot 替换与冲突成员 | NOT_RUN | NOT_RUN |  |
| WLD-007 | PG 提交结果未知恢复 | NOT_RUN | NOT_RUN |  |
| WLD-008 | outbox 补交接去重 | INCONCLUSIVE | INCONCLUSIVE | 临时PG仓储/授权桥接：有限有效形状、冲突/CAS、outbox回放、change去重 |
| WLD-009 | 同 change_id 同键异内容 | INCONCLUSIVE | INCONCLUSIVE | 临时PG仓储/授权桥接：有限有效形状、冲突/CAS、outbox回放、change去重 |
| WLD-010 | 锁竞争、死锁和事务回滚 | NOT_RUN | NOT_RUN |  |
| WLD-011 | 有效时间、接收时间与 freshness | NOT_RUN | NOT_RUN |  |
| WLD-012 | 稳定分页与变更冲突 | NOT_RUN | NOT_RUN |  |
| WLD-013 | 事实读取缺失与权限不混淆 | NOT_RUN | NOT_RUN |  |
| WLD-014 | 数据库不可用与恢复隔离 | NOT_RUN | NOT_RUN |  |
| SYS-001 | 慢模型不占有全局写锁 | INCONCLUSIVE | INCONCLUSIVE | TestMainDurableInboxDuringCall（仅已断言子项）; new input arriving during a Pi call（仅已断言子项） |
| SYS-002 | provider 错误分类与预算 | INCONCLUSIVE | NOT_RUN | TestResponsesKeysAndPartialResponse（仅已断言子项） |
| SYS-003 | 背压、突发与可靠接受 | INCONCLUSIVE | INCONCLUSIVE | 1000输入/2000请求，关闭后重新打开，逐条字节与状态核对 |
| SYS-004 | 24h/72h/7日资源稳定性 | NOT_RUN | NOT_RUN |  |
| SYS-005 | 时钟前跳回拨与时区 | NOT_RUN | NOT_RUN |  |
| SYS-006 | HTTP身份、同源与重连 | INCONCLUSIVE | NOT_RUN | TestIdentityOriginAndStrictIngress（仅已断言子项） |
| SYS-007 | 凭据隔离与程序环境 | INCONCLUSIVE | NOT_RUN | TestPathAndRoleBoundaries（仅已断言子项） |
| SYS-008 | 不可信材料诱导越权 | NOT_RUN | NOT_RUN |  |
| SYS-009 | 共享文件并发修改 | INCONCLUSIVE | FAIL | AUD01: 批准后文件改变 |
| SYS-010 | 契约全字段边界与严格解码 | INCONCLUSIVE | FAIL | AUD08: 拒绝 journal 外帧未知字段 |
| SYS-011 | 深层JSON、重复键与数值边界 | NOT_RUN | NOT_RUN |  |
| SYS-012 | UI授权可用性与断线 | INCONCLUSIVE | INCONCLUSIVE | TestTerminalConversationApprovalAndResult; TestSnapshotSelectionAndFrozenApproval（仅已断言子项）; TUI requires explicit viewed approval and rejects stale displays（仅已断言子项） |
| SYS-013 | 历史增长后的恢复与查询 | INCONCLUSIVE | INCONCLUSIVE | 1000输入/2000请求，关闭后重新打开，逐条字节与状态核对 |
| SYS-014 | 模块错误的故障隔离 | NOT_RUN | NOT_RUN |  |
| SYS-015 | 程序参数与查询内容的注入边界 | NOT_RUN | NOT_RUN |  |
| E2E-001 | 合成任务拒绝再新任务批准 | INCONCLUSIVE | INCONCLUSIVE | 现有真实模型合成任务链；未覆盖全部拒绝后重建顺序 |
| E2E-002 | 等待决定跨天换进程 | NOT_RUN | NOT_RUN |  |
| E2E-003 | 摘要纠正加任务反馈乱序 | NOT_RUN | NOT_RUN |  |
| E2E-004 | 外部作用未知跨模块重启 | NOT_RUN | NOT_RUN |  |
| E2E-005 | PG已提交与摘要未更新 | NOT_RUN | NOT_RUN |  |
| E2E-006 | 任务完成到退休再引用历史 | NOT_RUN | NOT_RUN |  |
| E2E-007 | 混合压力下全链恢复 | NOT_RUN | NOT_RUN |  |
| E2E-008 | 真实使用承诺回访 | NOT_RUN | NOT_RUN |  |
