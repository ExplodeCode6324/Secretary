# Issue #25 PR B：状态迁移校验

基线为 PR A 的 `77155a56abaeea3e1f384eabd5abd5d1f8364468`，本 PR 依赖其模块拆分。公共合同、journal/CAS 格式和领域操作语义保持原状。

## 缺陷与实现

首次隔离复现中，Store 接受 Execution `SUCCEEDED → RUNNING` 和 Operation `SUCCEEDED → DISPATCHED`，终态可被重新激活。新增 `state-transitions.ts` 从 catalog 派生合法状态对，在 Store.stage 对已有 Execution、Operation、Input 更新检查；提交和重放共用该入口。校验在 journal append/install 之前，整笔拒绝，不推进 sequence、digest、记录、索引、事件及回执。同状态更新、符合 Schema 的首次快照和 Input 身份约束保持原有语义。

`next(machine, state, event)` 保留原签名并由 Store 重新导出，Authorization.decide 继续按事件查表。catalog 收敛为四个被执行或调用的状态机，其余状态的流转由领域模块与文档说明。Schema 和生成文件只修改已删除目录项的描述，不改枚举或记录结构。

## 迁移校准

检查对象为源代码中的 setState、revise(state)、finish 调用及历史相邻快照。迁移表只判断状态对，授权、取消意图、进程停止、World 回执等前提仍由领域模块检查。

| 迁移 | 实际入口与前提 |
| --- | --- |
| Input ACCEPTED → CLAIMED；CLAIMED → HANDLED | main-loop.ts:349–409 领取固定批次；:670–673 完成批次 |
| Execution CREATED → WAIT_PRECONDITION；WAIT_PRECONDITION → READY | task-triggers.ts:422–462；execution-recovery.ts:208 恢复 CREATED |
| READY / WAIT_AUTH → WAIT_PRECONDITION | execution-runner.ts:71–102；Scope 不可派发或根目录不可用 |
| READY / WAIT_AUTH → DISPATCHING | execution-runner.ts:71–107；任务 ACTIVE、许可等待已结束，派发前取得执行槽 |
| DISPATCHING → RUNNING / WAIT_AUTH | execution-runner.ts:253–280；PROGRAM 可能先等待授权，AGENT 和已授权 PROGRAM 开始执行 |
| DISPATCHING → READY | execution-runner.ts:168–198 授权恢复；execution-recovery.ts:256–267 安全模型恢复 |
| RUNNING → WAIT_AUTH / WAIT_DECISION | executor-tools.ts:167、204、240–247；工具入口只接受正在运行且未取消的执行 |
| WAIT_DECISION → READY | execution-recovery.ts:125–138；有效工作回答 |
| RUNNING → SUCCEEDED / FAILED | executor-tools.ts:100 提交结果；effects.ts:383–387 程序结果；execution-runner.ts:394–398 缺少结构化结果 |
| DISPATCHING / WAIT_AUTH → FAILED | 当前 execution-runner.ts:174–178 先派发再处理拒绝；旧 scheduler.execute 在 WAIT_AUTH 直接处理拒绝，见下方历史依据 |
| RUNNING / DISPATCHING / CANCEL_REQUESTED → RESULT_UNKNOWN | effects.ts:119–133、196、394；execution-runner.ts:128–134；execution-recovery.ts:240–271，作用或停止结果未确定 |
| RUNNING / DISPATCHING → CANCEL_REQUESTED | execution-recovery.ts:141–147；running Map 中的执行取消 |
| CANCEL_REQUESTED → SUCCEEDED / FAILED / CANCELLED | effects.ts:351–387 程序停止或取消期间完成；execution-runner.ts:141–145、387–392 |
| CANCEL_REQUESTED → READY | execution-runner.ts:185–201；取消在授权作用 await 期间到达，作用完成后原流程恢复 READY，再按 cancel_requested 结束 |
| RUNNING → CANCELLED | effects.ts:351–359；process-runner.py:67–87 在启动前收到外部 SIGTERM 返回 not_started；真实进程回归确认不经 Scheduler.cancel、cancel_requested 保持 false |
| READY / WAIT_PRECONDITION / WAIT_AUTH / WAIT_DECISION → CANCELLED | execution-recovery.ts:149–153；不在 running Map 且无未停止进程 |
| READY / WAIT_PRECONDITION / WAIT_AUTH / WAIT_DECISION → EXPIRED | task-triggers.ts:437–440；显式期限已到、不在 running Map、不是 RESULT_UNKNOWN |
| RUNNING → READY | execution-recovery.ts:256–267；有持久模型调用、无未知作用、进程已停且未取消 |
| RESULT_UNKNOWN → FAILED | execution-recovery.ts:44–66；最后未知项处理完、进程已停且执行不再运行 |
| Operation WAIT_AUTH → AUTHORIZED / CANCELLED | authorization.ts:535–563；有效批准或拒绝 |
| AUTHORIZED → DISPATCHED / CANCELLED | authorization.ts:565–630；最终授权 gate 或 RULE_CHANGED |
| DISPATCHED → SUCCEEDED / FAILED / RESULT_UNKNOWN | authorization.ts:689–707 保存作用结果；:760–776 恢复未取得回执的派发 |
| RESULT_UNKNOWN → SUCCEEDED / FAILED | authorization.ts:689–735；核验或 Master APPLIED / NOT_APPLIED / PARTIAL / UNVERIFIED 裁定 |
| RESULT_UNKNOWN → DISPATCHED | authorization.ts:633–687；仅 World 同一数据库事务补做，不重新消费授权 |

### 历史兼容

- `9623095` 的 scheduler.ts:1123–1157 在 WAIT_AUTH 内处理拒绝、未知作用和授权恢复，明确写出 WAIT_AUTH → FAILED / RESULT_UNKNOWN / READY。当前代码先写 DISPATCHING；保留旧日志所需的边，新增缺失的 WAIT_AUTH → RESULT_UNKNOWN。
- 同版本 scheduler.ts:1209–1214 在 PROGRAM 真正派发前从 READY 写 WAIT_AUTH；authorization.ts:81–142 先持久化 PREPARED，再写 AUTHORIZED 或 WAIT_AUTH。这些旧路径与当前单次初始快照不同。
- 610 笔真实 task-reuse journal 实际出现 WAIT_AUTH → READY 和 PREPARED → WAIT_AUTH。658 笔 memory-validation journal 补充等待授权的非终态数据。
- 原目录中其余兼容边在本批继续保留；不能用有限语料中未出现某边，推断所有旧数据都未使用它。新增边必须有明确源码依据。原目录兼容边不表示当前调度器会产生该迁移。
- 仅按原目录保留、尚无当前 writer 或已审历史相邻快照证据的边：Execution CREATED → CANCELLED / EXPIRED、WAIT_AUTH → WAIT_DECISION、RESULT_UNKNOWN → SUCCEEDED；Operation PREPARED → CANCELLED、AUTHORIZED → WAIT_AUTH。依据为本批固定基线的既有 catalog，区别于上表确认的当前路径和已定位的旧 writer。

## 测试夹具调整

PR A 原测试零修改；PR B 对以下人工跳边作最小修正，保留业务断言：

| 文件 | 调整 |
| --- | --- |
| issue16/dispatch.test.ts | WAIT_PRECONDITION 经 READY、DISPATCHING 到 RUNNING；占用状态逐个建立独立历史快照；未知执行中的未知文件写入用独立历史快照，避免新派发 |
| issue16/verify-write.test.ts | Execution 先进入派发，Operation 经授权与派发后保存 UNKNOWN，再执行原 verify-write 断言 |
| issue17/authorization.test.ts | setup 经合法准备/派发序列进入 RUNNING；工具故障注入恢复也经 DISPATCHING |
| issue17/shell-process.test.ts | 真实 Store 重开夹具经合法序列进入 RUNNING |
| issue8/api.test.ts、issue8/review.test.ts | 决策夹具使用新的 WAIT_DECISION 历史快照，不复活已 SUCCEEDED 的执行 |

## 验证证据

本 PR `src/` 净减 788 行（包括 catalog 的移除）；运行时 TypeScript 净增 28 行。Store 为 777 行，新校验模块 46 行；PR A 的 Host 414 行、Scheduler 404 行、最大拆分模块 702 行保持不变。

- 新增表驱动覆盖 Execution 13×13、Operation 8×8、Input 3×3，共 242 个状态对，含同状态和非法事务原子性；另有独立终态复活拒绝、有效哈希非法 journal 重放拒绝、Authorization next 语义与四目录项断言。
- 取消恢复回归在真实授权写入完成窗口送达取消，确认 CANCEL_REQUESTED → READY → CANCELLED 且作用回执不丢失；进程协议回归新增外部 SIGTERM 在启动前停止程序，确认 RUNNING → CANCELLED，未执行程序副作用。
- 两份实际历史目录先确认 owner 锁无人持有，在持锁期间复制 journal/CAS 并核对全部文件哈希；新 Store 分别成功重放 610、658 笔事务。重放前后源与副本字节哈希均不变，未启动 Host/Scheduler/World。
- 修正夹具后的 35 项 Scope、授权和决策定向回归通过。完整套件、当前提交 CI 与最终复核结论在代码冻结后补充到 PR 评论。

## 复核记录

- 状态边审计 R1：采纳五条当前 Execution 缺边；针对报告遗漏 Operation World 补做边、决策/取消边以及旧版本 writer，提交具体源码异议。无真实触发依据的 run.catch terminal guard 建议未采纳；本批不改变领域失败处理语义。
- R2：reviewer 接受 World 补做边、补齐遗漏、撤回 terminal guard 建议并确认原兼容边保留。新增 CANCEL_REQUESTED → READY；移除无法证明的新增 DISPATCHING → CANCELLED。针对 RUNNING → CANCELLED 的异议，以真实进程测试证明外部信号路径，再交同一会话复核。
