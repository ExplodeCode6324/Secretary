# Issue #23：Codex 与本地 Hermes 协作记录

## 授权与流程

2026-10-16，Master 授权一个子代理持续连接本地 Hermes，指定模型 `/model claude-opus-5.5 --provider copilot`。先由 Hermes 复核 [fix 计划](../fix_20261016_issue23_Core主会话定时唤醒.md)；Codex 评估意见、修改计划或说明异议，直到明确通过才实施。实施后提交 PR、完成 CI，再重复复核至达到合并条件。未明确授权本次自动合并或部署。

复核范围仅 Core；SwiftUI 路线已废弃。子代理负责联络，主代理负责评估与修改；不把子代理自己的意见冒充 Hermes 结论。最终报告协作过程，由 Master 确认后才创建可复用 skill。

公开记录保留问题、理由、决定、修改与验证摘要；原始模型会话和运行日志保存在 Git 忽略目录，不发布凭据、真实会话标识或本机配置。

## 进度

| 轮次 | 对象 | Hermes 结论 | Codex 处置 | 状态 |
| --- | --- | --- | --- | --- |
| P1 | 基于 main 4786b12 的初始计划 | CHANGES_REQUIRED；2 项阻塞 | B1 工具恢复、B2 时钟注入均采纳；N1–N7 建议全部纳入，无异议 | 修订完成 |
| P2 | P1 修订后的计划 | PASS；B1/B2 与 N1–N7 全部关闭 | 按 Master 条件授权开始实施；共享 Wakeups 实例/时钟，恢复只读已保存回执 | 已通过 |
| R1 | PR #47，29c1a9f | PASS_PENDING_CI；认可 UUID 回执恢复与事务/来源边界 | 保留最终 CI 门槛；O1 创建时扫描留待 #24，O3 import 顺序采纳；O2 异常容量仅日志建议提出异议 | 未批准合并 |
| R1b | 对 R1 补充检查取消参数与来源测试 | CHANGES_REQUIRED；额外参数摘要不一致、多输入来源证据缺口 | 均采纳，统一新工具参数身份、收紧 schema，补恢复与来源测试 | 已修复，等待 R2 |

联络子代理通过本地 CLI 的 `--model claude-opus-5.5 --provider copilot` 指定本轮模型和 provider；JSON 初始化与会话记录确认模型为 claude-opus-5.5，调用显式选择 copilot。没有配置备用模型。复核已实际读取 Host 工具恢复、Store 事务、pump、API 和同步代码。

P1 的具体处置：补 schedule/cancel 的 Host.recoverTools 安全对账、无变化取消领域回执、缺回执仍阻塞的断言；明确工具 key 含参数 hash，因此不能声称同调用异参是同身份冲突。明确 Wakeups/App 注入同一时钟，领域业务时间与真实 journal 时间分别验证。其余建议包括 API 无变化关联、稳定 Input ID/revision、同步提交区间、PENDING 扫描计数、settle 到期交付、TIMER-only 闭环、不做历史清理。Hermes 明确确认模型 claude-opus-5.5 与 provider copilot。

R1b 起因是 Codex 自查发现：取消实际调用只使用 timer_id，而恢复使用模型原始参数，额外键可能使摘要不同。Hermes 检查实际依赖的参数校验代码确认缺陷，并提出多输入来源测试要求。两项均纳入修复；真实 Settings apply 作为补充。

O2 异议理由：合法数据只允许 100 个 PENDING；超过上限属于损坏或违反合同的数据。只记日志仍启动会静默破坏周期扫描有界性，因此保留明确拒绝启动。该理由已通过联络子代理交给 Hermes，待下一轮明确处置。

CI 首轮运行 38900159278：Native 成功，Core/verify 失败，Core skipped=0。三项真实失败分别是长会话整理预算目标、Settings 恢复预算和 API 操作表顺序。保留原断言与首轮日志，修复后重新验证，不将 R1 的条件结论当作合并批准。

## 最终交付

待记录计划通过版本、实现修订、PR 最终 head、CI、合并条件复核结论和未解决限制。当前没有通过结论，也未创建 skill。

R1b 修订补充：22/22 定向测试通过，包含数值 note 的真实 SIGKILL 恢复、额外参数拒绝、多 Master/TIMER 来源和 Settings apply。为恢复既有预算门槛，等义精简 Host 系统说明；没有更改预算、旧 fixture 或断言，交 R2 核查语义等价。

R2 期间 Codex 补查 PG 输入投影，复现 TIMER 后 Settings apply 的 INVALID_INPUT_SETTINGS_COVERAGE；立即通知 Hermes：2e62ed0 不可作为最终通过版本。修订 input-projection 的来源过滤并新增数据库/重启回归，23/23 定向通过。完整验证重新从新版本开始。
