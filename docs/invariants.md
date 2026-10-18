# 系统不变量

以下约束对应 Core 的持久化与执行路径。每条列出适用范围、实现入口和验证用例；模型提示词表达工作约定，宿主代码执行这些约束。

1. **一个数据目录只有一个 writer。** 持锁 helper 执行 journal 追加；已关闭或失去所有权的 Store 拒绝提交。
   实现：[Store.commit](../src/pi_secretary/src/store.ts)、[store-lock](../src/pi_secretary/src/store-lock.ts)。测试：[store-ownership](../test_case/offline/issue19/store-ownership.test.ts)，`live owner excludes another opener`。

2. **确认持久化后才安装事务状态。** 记录、事件和回执经过整笔校验，收到匹配请求 ID、sequence、digest 的 fsync ACK 后一起进入内存；确认丢失时重新打开并按 journal 对账。
   实现：[Store.commit / stage](../src/pi_secretary/src/store.ts)、[store-channel](../src/pi_secretary/src/store-channel.mjs)。测试：[transport](../test_case/offline/issue24/transport.test.ts)，`invalid ... ACK never installs, but reopen recovers fsynced transaction`。

3. **CAS 引用对应固定字节。** 提交/重放检查引用路径、普通文件和长度，mutation 快照验证哈希；正文读取时验证完整 SHA-256，同长度正文损坏在读取或完整校验时发现。
   实现：[Store.read / stage](../src/pi_secretary/src/store.ts)。测试：[store](../test_case/offline/issue24/store.test.ts)，`reference metadata rejects missing, truncated and symlink objects; reads reject same-length corruption`。

4. **成功模型响应先保存，工具后执行。** 主会话和任务的 durableStream 在完整成功响应持久化后交给 Agent；恢复复用已保存成功响应。
   实现：[durableStream](../src/pi_secretary/src/transport.ts)。测试：[crash](../test_case/offline/issue19/crash.test.ts)，`real SIGKILL at ... durable boundary preserves model work and attempt count`；[任务恢复](../test_case/offline/issue18/model-crash.test.ts)。

5. **模型重试按逻辑调用累计。** 一次逻辑调用最多三次发送；重启沿用已用次数，暂时传输错误适用退避，取消、认证及本地容量错误分别结束。
   实现：[durableStream](../src/pi_secretary/src/transport.ts)、[transportFailure](../src/pi_secretary/src/model-retry.ts)。测试：[retry](../test_case/offline/issue19/retry.test.ts)，`saved failure diagnostics permit exactly three sends and success replay`。

6. **审批绑定当前展示内容与版本。** decide 校验 expected_revision/display_hash；批准并记住将授权和限定范围的规则原子提交，派发前重新校验规则及资源。
   实现：[Authorization.decide / dispatch / remember](../src/pi_secretary/src/authorization.ts)。测试：[API](../test_case/offline/issue8/api.test.ts)，`approval exact display/CAS`；[authorization](../test_case/offline/issue17/authorization.test.ts)，`REM-04 commit failure publishes neither approval nor remembered rule`、`REM-01/03/04: approve and remember is atomic, replayable, prefix constrained and disables at dispatch`。

7. **未知外部效果等待核验或裁定。** RESULT_UNKNOWN 的 shell/program 不自动重放；文件写入可核验，owner 可作 APPLIED/NOT_APPLIED/PARTIAL/UNVERIFIED 裁定。效果收束与受控进程确认停止共同决定执行收束。
   实现：[Authorization.resolve](../src/pi_secretary/src/authorization.ts)、[settleUnknownExecution](../src/pi_secretary/src/execution-recovery.ts)。测试：[resolution](../test_case/offline/issue18/resolution.test.ts)，`resolution cannot release an unconfirmed process`；[shell](../test_case/offline/runtime/shell.test.ts)，`timeout preserves uncertainty and never replays partial shell effects`。

8. **进程身份持久化后才允许启动。** shell/program wrapper 就绪后等待启动帧；启动前取消记为未施加，缺少结果帧记为未知效果。
   实现：[launchProcess](../src/pi_secretary/src/process-control.ts)、[process-runner](../src/pi_secretary/src/process-runner.py)。测试：[process-protocol](../test_case/offline/issue18/process-protocol.test.ts)，`cancellation after ready but before start has no effect`、`wrapper exit without a result frame is unknown`。

9. **Execution 的工作根创建后固定。** Scope 更新影响未来执行；已绑定根与仍占槽的旧根继续参与冲突检查，同一 DIRECTORY 的已占槽执行串行推进。
   实现：[Scopes / occupies](../src/pi_secretary/src/scopes.ts)、[execution-runner](../src/pi_secretary/src/execution-runner.ts)。测试：[scopes](../test_case/offline/issue16/scopes.test.ts)，`Execution freezes root`；[dispatch](../test_case/offline/issue16/dispatch.test.ts)，`run acquires synchronously`。

10. **文件工具按绑定根校验路径。** read、write 和 submit_result 产物通过 safePath/relativePath 拒绝绝对路径、越界片段与符号链接路径；shell/program 使用本机用户权限。
    实现：[executor-tools](../src/pi_secretary/src/executor-tools.ts)、[safePath](../src/pi_secretary/src/effects.ts)、[relativePath](../src/pi_secretary/src/scopes.ts)。测试：[workspace](../test_case/offline/issue16/workspace.test.ts)，`notes are bounded UTF-8 data, unsafe paths fail`、`approved write waits through unsafe root replacement`；[scopes](../test_case/offline/issue16/scopes.test.ts) 的 `DIRECTORY rejects overlapping roots, data roots, symlink parents and unsafe notes` 覆盖共享校验器的越界及符号链接拒绝，工具接入由上述调用点核对。

11. **命令 ID 绑定原始意图。** owner、路径和规范化 body 相同的 request_id 返回原回执，冲突提交被拒绝；短命令受理与首次领域变更同事务，长命令中断后的 UNKNOWN 保留对账状态。
    实现：[ApplicationService](../src/pi_secretary/src/application-service.ts)。测试：[API](../test_case/offline/issue8/api.test.ts)，`two clients: concurrent dedup, cross-command conflict`；[admission-boundary](../test_case/offline/issue8/admission-boundary.test.ts)。

12. **摘要成功与承诺提取分别提交。** 提取失败保留冻结来源和分段进度，补提与当前承诺账本合并，保留已经解决的状态。
    实现：[memory-summary](../src/pi_secretary/src/memory-summary.ts)、[memory-extraction](../src/pi_secretary/src/memory-extraction.ts)。测试：[retry](../test_case/offline/issue19/retry.test.ts)，`summary coverage and Settings commit survive extraction failure`。

13. **旧输入退出需要成功覆盖与检索水位。** 只有身份明确、完整覆盖且位于当前轮次和工具协议保护区之外的原文可退出；索引不可用时保留原退出回执并暂停新增退出。
    实现：[selectInputProjection](../src/pi_secretary/src/input-projection.ts)。测试：[projection](../test_case/offline/issue28/projection.test.ts)，`FAILED/STALE, uncovered and current Inputs survive`、`unavailable search freezes previous coverage`；[settings](../test_case/offline/issue28/settings.test.ts)，`in-flight search outage after World commit`。

14. **Settings 以回执连接两个存储。** World 批次原子提交事实与回执；本地有效说明、Consciousness、Context 与 APPLIED 同事务提交，重试先确认已提交批次。
    实现：[Settings](../src/pi_secretary/src/settings.ts)、[World](../src/pi_secretary/src/world.ts)。测试：[settings](../test_case/offline/runtime/settings.test.ts)，`draft is durable and inactive; application summarizes both reference sets`；同文件 `database commit followed by SIGKILL restores the same batch`。

15. **持久同步游标标识 journal 前缀。** cursor 绑定 owner、sequence、digest，重启可续传，分叉或截短历史要求重新加载；changes 按完整事务交付，超大事务转为类别失效通知。
    实现：[SyncService.position / changes](../src/pi_secretary/src/sync-service.ts)。测试：[cursor](../test_case/offline/issue9/cursor.test.ts)，`same identity restored backup rejects divergent digest`；[changes](../test_case/offline/issue9/changes.test.ts)，`oversized complete transaction falls back`。

16. **唤醒只入队一次。** FIRED 与唯一 TIMER Input 同事务提交；只取消 PENDING，TIMER 保留来源身份并按主会话既有恢复和授权规则处理。
    实现：[Wakeups.fireDue / cancel](../src/pi_secretary/src/wakeups.ts)。测试：[wakeups](../test_case/offline/issue23/wakeups.test.ts)，`wakeup atomically queues one sourced TIMER input`；[来源保护](../test_case/offline/issue23/host.test.ts)。

17. **渠道接受、展示与已读独立记录。** 推送在四次尝试预算内重试，渠道接受后未保存结果的崩溃可能重复发送；presented 按通知/客户端去重，read_at 全局保留首次时间。
    实现：[Pushes.tick](../src/pi_secretary/src/push-service.ts)、[Notifications](../src/pi_secretary/src/notification-service.ts)。测试：[push](../test_case/offline/issue22/push.test.ts)，`fourth interrupted attempt is terminal`；[notifications](../test_case/offline/issue9/notifications.test.ts)，`presented event and admission are atomic, read is global and separate`。

18. **受管理的状态变化须命中迁移表。** Store 提交与重放检查 Execution、Operation、Input 的前后状态；同状态更新和符合 schema 的首次快照另行处理，领域守卫继续检查业务前提。
    实现：[validateStateTransition](../src/pi_secretary/src/state-transitions.ts)、[Store.stage](../src/pi_secretary/src/store.ts)。测试：[transitions](../test_case/offline/issue25/transitions.test.ts)，`every state pair`、`replay rejects a correctly hashed journal carrying an illegal transition`。
