# 修复计划

> **2026-10-23：** 客户端路线已切换至 [TUI](../tui/requirements-and-backend-plan.md)（[#57](https://github.com/ExplodeCode6324/Secretary/issues/57)）。旧 #62—#67 的 GUI 工作冻结；#63 的共享 Core 终态缺口由 [#80](https://github.com/ExplodeCode6324/Secretary/issues/80) 承接。下表保留原计划的历史状态，领取新工作按 TUI 分段 Issue，不沿旧 Tauri 页面路线继续实施。

当前计划记录范围、方案、复核意见与验证结果；已结束计划及其证据保存在[归档](archive/index.md)，按原版本追溯。

| Issue | 计划 | 状态 |
| --- | --- | --- |
| #82 | [TUI 基础与 Main（中文）](fix_20261024_issue82_TUI基础与Main.md) · [English](fix_20261024_issue82_TUI基础与Main.en.md) | R5 CHANGES_REQUIRED / P2有限独立事件验证；协调选定browser命令式界面+plain DOM范围，R6待同Claude计划复核及正式实施释放；[复核记录](evidence/issue82-tui/plan-review.md) |
| #81 | [附件闭环（中文）](fix_20261023_issue81_附件闭环.md) · [English](fix_20261023_issue81_附件闭环.en.md) | 已合并；[PR #87 最终记录](https://github.com/ExplodeCode6324/Secretary/pull/87#issuecomment-6371806717)，[main CI 通过](https://github.com/ExplodeCode6324/Secretary/actions/runs/40002665230)；真实 provider 验证留 #84 |
| #80 | [回复终态与推理预览（中文）](fix_20261023_issue80_回复终态与推理预览.md) · [English](fix_20261023_issue80_回复终态与推理预览.en.md) | 已合并；[PR #86 最终记录](https://github.com/ExplodeCode6324/Secretary/pull/86#issuecomment-6368012380)，[main CI 通过](https://github.com/ExplodeCode6324/Secretary/actions/runs/39976324062) |
| #79 | [Tauri 退役（中文）](fix_20261023_issue79_Tauri退役.md) · [English](fix_20261023_issue79_Tauri退役.en.md) | 已合并；[PR #85 最终记录](https://github.com/ExplodeCode6324/Secretary/pull/85#issuecomment-6364909080)，[main CI 通过](https://github.com/ExplodeCode6324/Secretary/actions/runs/39952748532) |
| #63 | [主对话与统一时间线（中文）](fix_20261023_issue63_主对话与统一时间线.md) · [English](fix_20261023_issue63_主对话与统一时间线.en.md) | Master 已批准 R2 修订；实施与验证中，随后同一 Claude 会话复核及 PR/CI |
| #62 | [PhaseUI 设计系统（中文）](fix_20261021_issue62_PhaseUI设计系统.md) · [English](fix_20261021_issue62_PhaseUI设计系统.en.md) | R2 中英文计划；Claude Opus 5.5 Extra 三轮复核 PASS，实施待 Master 批准 |
| #61 | [PhaseUI 现行规范（中文）](fix_20261021_issue61_PhaseUI现行规范.md) · [English](fix_20261021_issue61_PhaseUI现行规范.en.md) | R1 已批准；文档整合完成，待 Master 终审 |
| #59 | [原生通信与可靠同步](fix_20261020_issue59_原生通信与可靠同步.md) | PR #69；实现完成，R2 并发修订验证中 |
| #58 | [Tauri 可行性验证](fix_20261019_issue58_Tauri可行性验证.md) | Master 已授权，Mac 实施与验收中；Linux 暂缓且不阻塞 |
| #27 | [按代码重写文档](fix_20261018_issue27_按代码重写文档.md) | PR #55 已合并，main CI 通过 |
| #10 | [删除废弃 SwiftUI 客户端](fix_20261019_issue10_删除废弃SwiftUI客户端.md) | 计划复核通过，实施与验证中 |

Core 计划统一放在本目录，文件名为 `fix_YYYYMMDD_issueN_说明.md`。当前行为以[现行手册](../README.md)为准。

