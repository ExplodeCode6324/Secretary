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

联络子代理通过本地 CLI 的 `--model claude-opus-5.5 --provider copilot` 指定本轮模型和 provider；JSON 初始化与会话记录确认模型为 claude-opus-5.5，调用显式选择 copilot。没有配置备用模型。复核已实际读取 Host 工具恢复、Store 事务、pump、API 和同步代码。

P1 的具体处置：补 schedule/cancel 的 Host.recoverTools 安全对账、无变化取消领域回执、缺回执仍阻塞的断言；明确工具 key 含参数 hash，因此不能声称同调用异参是同身份冲突。明确 Wakeups/App 注入同一时钟，领域业务时间与真实 journal 时间分别验证。其余建议包括 API 无变化关联、稳定 Input ID/revision、同步提交区间、PENDING 扫描计数、settle 到期交付、TIMER-only 闭环、不做历史清理。Hermes 明确确认模型 claude-opus-5.5 与 provider copilot。

## 最终交付

待记录计划通过版本、实现修订、PR 最终 head、CI、合并条件复核结论和未解决限制。当前没有通过结论，也未创建 skill。
