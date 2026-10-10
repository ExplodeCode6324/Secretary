> 历史测试记录：本文保留原运行版本、失败和结论，不作为当前 Core/原生客户端已经验收的证明。旧路径或命令仅供追溯；当前证据见 [API v1 验证记录](../../../docs/api/v1/verification.md)。

# 任务复用与多次执行验收

核查基线为 28ec06a（实现基线 7f4cf24），当前只进行开发和隔离验证，未部署或重启现用服务。原始日志、真实模型转录和 UUID 对照保存在本目录被忽略的运行文件中；本报告保留可公开的合成场景结论。

## 实现语义

- TaskPlan.pending_requests 独立保存即时请求；request_id 同时作为 occurrence_key。周期队列与未来基线保持原样。
- Execution.proposal_ref 固定本轮完整有效要求。旧记录从 journal 中 plan_revision 对应的 TaskPlan 固定来源，缺失时阻塞。
- 最新已结束且未回收的 parent 才能接续；活跃、待执行、未知操作、过期引用或 workspace 异常拒绝，不创建替代任务。
- 同任务共享 work 目录，旧 TaskResult 产物仍保存在不可变 objects 中。pending parent 保护在分派时换成执行 ID，结束/取消/拒绝释放。
- 新增 cancel_request 处理未分派请求。Host 恢复只重建已证明有 Scheduler 回执的 task_propose 返回值，其他未知工具继续阻塞。
- PROGRAM 继承身份、版本和参数，goal 明确更新，并在受理和派发前校验参数。新执行不复用旧单次授权。

## 首次失败及处理

1. initial-failures.tap：原实现 2/2 失败，复用实际新建任务、缺 parent 未拒绝。
2. targeted-first.tap：13 通过、1 失败；恢复推进为 READY 后 tick 使用旧状态。修复扫描状态刷新。
3. targeted-second.tap：16 通过、2 失败；测试驾驶器误读上游工具声明位置、前提 fixture 使用错误字段。修正为 system message 中的工具契约和 required_revision，未放宽产品断言。
4. targeted-third.tap：18/18 通过。
5. targeted-fourth.tap：24 通过、1 失败；真实 SIGKILL 后 Host 缺工具回执进入 RECOVERY_BLOCKED。补充已接受提案回执重建，host-recovery-fix.tap 专项通过。
6. live-first.log / task-reuse-1790653867524.json：O01 通过；O02 写文件后模型请求 wc/file shell 检查，超出本测试授权范围而停止。未批准 shell。后续输入明确只读写报告、不运行命令，保持原授权边界；不把首次失败改为通过。

7. live-second.log / task-reuse-1790654035796.json：O01–O04 通过，O05 新执行触发 CAPACITY_BLOCKED，O06 未执行。复核发现材料递归增长（1297→44214→183012→777654 bytes）。新增 source_context_refs 与直接 parent 证据投影；material-growth.tap 连续 12 次接续通过，原始 checkpoint 不变，提示包低于 60 KB 且末轮不到首轮 1.5 倍。

## 验证进度

最终代码的普通回归为 102 项：97 通过、0 失败、5 项数据库用例按入口规则跳过（regression-after-material-fix.tap）。审计回归 36/36 通过（review-after-material-fix.tap），AUD14 仍按项目既有规则排除。定向任务用例共 30 项，全部纳入上述普通回归；随后补充的驾驶器计数专项 1/1 通过（live-budget.tap），该用例也已纳入今后的 npm test；material-growth.tap 另记录连续 12 次接续专项。

| 验收 | 结果与主要证据 |
| --- | --- |
| A01 | 通过：真实 Host 工具定义与参数透传；受理回执关联正确 |
| A02 | 通过：列表可发现真实任务、任务详情含目标/要求/结果；访问隔离与双 ID 拒绝 |
| A03 | 通过：T1 下 E1→E2→E3，任务总数不增加 |
| A04 | 通过：新要求快照、旧验收项拒绝、前提/截止时间、重启与不可覆盖检查 |
| A05 | 通过：null/省略继承、空约束与空验收区别；PROGRAM 身份与参数保留 |
| A06 | 通过：真实文件读改、旧产物对象字节保留；13 轮执行不递归嵌套旧提示包 |
| A07 | 通过：缺 parent、跨 task、旧 parent、回收、不可用计划、workspace/引用缺失均拒绝 |
| A08 | 通过：RUNNING/WAIT_DECISION/WAIT_AUTH/RESULT_UNKNOWN、终结但有关联未决操作均阻止新接续；普通决定路径由既有回归覆盖 |
| A09 | 通过：受理后、分派后、完成后重投不重建；更改内容或 session 冲突；null 与省略统一，旧指纹不忽略新增前提 |
| A10 | 通过：竞争请求第二条忙碌；重复 tick 不增执行；同键重复队列清除 |
| A11 | 通过：受理前/后、创建前/后、分派后、Host 工具结果前 6 个真实 SIGKILL 故障点；未知执行保持阻塞；现有操作未知结果回归通过 |
| A12 | 通过：周期 anchor/未来到期/基线要求保持，即时接续使用独立键；AT/INTERVAL/PROGRAM 既有回归通过 |
| A13 | 通过：parent 保护、释放、取消/CLOSED/失效拒绝；列表不刷新留存、RETIRED 不激活 |
| A14 | 通过：v1 once/旧字段/旧回执、历史计划精确固定；未开始旧任务只运行一次；之后可接续 |
| A15 | 通过：新建和 parent-only 保持；文件与 PROGRAM 均重新要求单次授权；原有权限/持续规则/未知结果审计通过 |

最终独立 PostgreSQL 回归 11/11 通过、0 跳过（postgres-final.tap），补验普通入口跳过的数据库路径。

第三轮真实模型 O01–O06 全部通过（live-third.log / task-reuse-1790654588348.json）。模型为 opencode-go / deepseek-v4.1-flash，主会话 23 次、任务 19 次，总耗时 335036 ms。独立复核持久转录得到 30 次工具调用，低于 100 次上限。原驾驶器按下一次模型输入统计时漏计最后的 submit_result（报告字段为 25）；已改为在完整真实响应交付前计数，并增加 live-tool-budget.test.ts，真实响应事件保持不变。本次成功运行的产品代码 hash 与最终代码一致；计数器修正属于测试驾驶器，未再消耗 API 重跑相同场景。

| 场景 | 实际结果 |
| --- | --- |
| O01 分析方案 | 主会话直接分析，0 Task / 0 Execution |
| O02 生成后补信息 | T1/E1 → T1/E2，同任务更新预算；原产物字节可读取 |
| O03 解释依据 | 仍是 T1 的 2 个执行，未新增执行，回复指出预算来自 Master |
| O04 压缩 | T1/E3，正文符合 600 字要求，保留预算和原数据 |
| O05 重启续改 | 正常重启未重放旧请求，随后 T1/E4，保留预算并增加复核日期 |
| O06 独立交付 | 新建 T2 及其首轮执行，未错误合并进 T1 |

最终 2 个 Task、5 个 SUCCEEDED Execution；5 个操作均为限定文件的 file.write 并成功，无 shell 操作。完整 task/execution ID、快照和产物内容留在本地原始证据中。

内容质量观察：O01 模型分析推演了未明确给出的上线前两周统计窗口并计算显著性。O01 通过证明能直接分析而不建任务，不证明该统计推导已被独立验证。此处作为模型内容质量限制记录，不能把调度行为验收包装成所有分析事实正确。

其他检查：npm run check、types:generate、docs:generate、docs:check、format:check 与 git diff --check。文档检查当前为 172 文件、2762 本地链接，无错误；生成结果与契约源同步。

## 回退与限制

新字段不兼容旧版严格 schema，因此不能把升级后的 journal 直接交给旧代码。保留完整备份和支持新字段的版本；发生新执行或副作用后只能在保留历史的前提下修复/核验，不能恢复旧备份后重做工作。当前未在现用数据上执行迁移，没有 REAL_USE 或部署证据。实现仅保存在本地分支，未推送 GitHub。

未实现运行中追加、历史版本分支、归档恢复、语义搜索、自然语言重复请求去重或外部副作用全局恰好一次。模型成功仅表示指定配置下这些合成场景通过。
