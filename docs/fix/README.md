# 修复计划

> **2026-10-30：** 当前客户端重建依据为 [TUI 临时实施参考 v1.7](../tui/implementation-reference.md) 及其第 11 节的六个功能批次和 #84 终验。#82/#83/#84 已全文重写，另建四个分批 issue；领取工作以新正文为准。旧 #62—#67 GUI 工作保持冻结；#79—#81 属已完成业务基线。下表保留历史计划及当时状态，不沿旧 Tauri 页面或回滚前 #82 的方案继续实施。

当前计划记录范围、方案、复核意见与验证结果；已结束计划及其证据保存在[归档](archive/index.md)，按原版本追溯。

| Issue | 计划 | 状态 |
| --- | --- | --- |
| agile 005 | [实施计划](fix_20261108start_敏捷迭代专题/005-实施计划.md) · [English](fix_20261108start_敏捷迭代专题/005-implementation-plan.en.md) · [操作与验证](fix_20261108start_敏捷迭代专题/005-操作与验证.md) · [提示词盘点](fix_20261108start_敏捷迭代专题/005-提示词盘点.md) | Master 已批准；实现、CI 与同一 Claude 会话终审进行中 |
| #111 | [World / Scope 总计划（中文）](fix_20261112_issue111_world_model_scope.md) · [English](fix_20261112_issue111_world_model_scope.en.md) · [交接与历史档案](evidence/issue111-world-model-scope/README.md) | 完整 R5 总计划；子项分别维护执行计划；系列真实记忆验收留待全部完成后在 agile 进行 |
| #112 | [World 实施计划（中文）](fix_20261112_issue112_world.md) · [English](fix_20261112_issue112_world.en.md) · [验收记录](evidence/issue112-world/acceptance.md) | [PR #115](https://github.com/ExplodeCode6324/Secretary/pull/115) 已合并；隔离后端验证与 main CI 通过；系列真实验收后置 |
| #113 | [Scope 导入执行计划（中文）](fix_20261112_issue113_scope.md) · [English](fix_20261112_issue113_scope.en.md) | 待实施；精确授权、原子 Scope 创建及独立环境报告轮次 |
| #114 | [Shared 执行计划（中文）](fix_20261112_issue114_shared.md) · [English](fix_20261112_issue114_shared.en.md) | 待实施；默认虚拟 Shared、持久任务目录及路径可见性 |
| #105 | [稳定标题、固定轮次与导航（中文）](fix_20261107_issue105_identity.md) · [English](fix_20261107_issue105_identity.en.md) | R2 Claude Opus 5.5 Extra 计划复核 PASS；非阻塞细化已纳入；[复核记录](evidence/issue105-identity/plan-review.md)；实施待 Master 批准 |
| #82 | [终端双入口计划（中文）](fix_20261030_issue82_terminal.md) · [English](fix_20261030_issue82_terminal.en.md) | R3 Claude Opus 5.5 Extra 三轮计划复核 PASS；[复核记录](evidence/issue82-rebuild/plan-review.md)；实施待 Master 批准 |
| #81 | [附件闭环（中文）](fix_20261023_issue81_附件闭环.md) · [English](fix_20261023_issue81_附件闭环.en.md) | R3；协调已批准实施，Claude Opus 5.5 Extra 三轮计划复核 PASS；[复核记录](evidence/issue81-attachments/plan-review.md)，[实施证据](evidence/issue81-attachments/implementation-review.md)；待准确 HEAD 复核与 CI |
| #80 | [回复终态与推理预览（中文）](fix_20261023_issue80_回复终态与推理预览.md) · [English](fix_20261023_issue80_回复终态与推理预览.en.md) | 已合并；[PR #86 最终记录](https://github.com/ExplodeCode6324/Secretary/pull/86#issuecomment-6368012380)，[main CI 通过](https://github.com/ExplodeCode6324/Secretary/actions/runs/39976324062) |
| #79 | [Tauri 退役（中文）](fix_20261023_issue79_Tauri退役.md) · [English](fix_20261023_issue79_Tauri退役.en.md) | 已合并；[PR #85 最终记录](https://github.com/ExplodeCode6324/Secretary/pull/85#issuecomment-6364909080)，[main CI 通过](https://github.com/ExplodeCode6324/Secretary/actions/runs/39952748532) |
| #63 | [主对话与统一时间线（中文）](fix_20261023_issue63_主对话与统一时间线.md) · [English](fix_20261023_issue63_主对话与统一时间线.en.md) | Master 已批准 R2 修订；实施与验证中，随后同一 Claude 会话复核及 PR/CI |
| #62 | [PhaseUI 设计系统（中文）](fix_20261021_issue62_PhaseUI设计系统.md) · [English](fix_20261021_issue62_PhaseUI设计系统.en.md) | R2 中英文计划；Claude Opus 5.5 Extra 三轮复核 PASS，实施待 Master 批准 |
| #61 | [PhaseUI 现行规范（中文）](fix_20261021_issue61_PhaseUI现行规范.md) · [English](fix_20261021_issue61_PhaseUI现行规范.en.md) | R1 已批准；文档整合完成，待 Master 终审 |
| #59 | [原生通信与可靠同步](fix_20261020_issue59_原生通信与可靠同步.md) | PR #69；实现完成，R2 并发修订验证中 |
| #58 | [Tauri 可行性验证](fix_20261019_issue58_Tauri可行性验证.md) | Master 已授权，Mac 实施与验收中；Linux 暂缓且不阻塞 |
| #27 | [按代码重写文档](fix_20261018_issue27_按代码重写文档.md) | PR #55 已合并，main CI 通过 |
| #10 | [删除废弃 SwiftUI 客户端](fix_20261019_issue10_删除废弃SwiftUI客户端.md) | 计划复核通过，实施与验证中 |

既有 Core 计划在本目录全量保留。自 2026-11-08 起，敏捷迭代计划统一放在本目录下的 `docs/fix/fix_20261108start_敏捷迭代专题/`；入口为[文档收敛与敏捷基线](fix_20261108start_敏捷迭代专题/001-文档收敛与敏捷基线.md)及其 [English](fix_20261108start_敏捷迭代专题/001-document-consolidation-and-agile-baseline.en.md)。当前行为以[现行手册](../README.md)为准。



命名约定：常规修复计划使用 `fix_YYYYMMDD_issue编号_主题.md`，英文版使用同名 `.en.md`；配套交接、验收与历史快照放在 `evidence/issue编号-主题/`。专题目录保留专题内的编号文件。
