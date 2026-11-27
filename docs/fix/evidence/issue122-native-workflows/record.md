# #122 工作流与检出清理记录

[中文方案](../../fix_20261127_issue122_native_workflows.md) · [English plan](../../fix_20261127_issue122_native_workflows.en.md)

## 构建记录

以 Secretary main 的 PR #137 为开发基线，核对既有 secretary-pr-fix、agile 000/002/005 和两个 checkout 的现行说明。将计划、修复、敏捷部署边界和独立复核程序拆入四份工作流。Master 随后明确根目录规范与流程全部入 Git；据此采用单一大写 AGENTS.md，并取消原拟定的本机专用入口与 Codex 回退配置。初版的项目与工作站 skill 曾转到对应流程。Master 在检查期间决定撤下两个入口，后续直接从 AGENTS.md 读取四份工作流。旧版本留存在私有历史备份中。

每轮沿用原中英文文件名或敏捷专题编号。方案、构建经过、测试证据、复核结论可在同一记录分节，公开材料只含脱敏结果。首次失败、私有原始材料及完整校验回执由私有归档保存。

## 测试证据

| 检查 | 结果 |
| --- | --- |
| Git 跟踪与一致性 | 开发提交 `ba1eb595`、敏捷本地提交 `23d45b06` 的 AGENTS.md、四份工作流和项目 skill 共六个文件逐字节相同。分别对照工作副本，42 处相对链接均指向已跟踪文件。实例启停器、机器专属使用说明和测试凭据仍受忽略保护。 |
| 项目文档检查 | 两个 checkout 均运行 `npm run docs:check`，链接及本地化检查通过。开发侧检查 743 份 Markdown、7,319 处链接，敏捷侧 718 份、7,256 处。 |
| 工具入口 | Codex 0.153.4 的 `codex debug prompt-input` 输出包含本项目 AGENTS.md 与项目 skill。Antigravity CLI 1.5.18 启动时显示未登录，登录后的技能发现和实际构建记为 NOT_TESTED。 |
| 测试范围 | 产品程序与记忆机制均无改动。记忆性能测试 NOT_APPLICABLE。此次没有派发原生系统或评分模型请求。 |

移除 skill 后再次运行两边的 `npm run docs:check`，均通过。开发和敏捷检出的 AGENTS.md 与四份工作流逐字节一致。新启动的 Codex 读取根规范，技能清单中已无旧入口。

## 工作区清理与证据保留

逐项查验 12 个 #122 检出和一个旧协调目录。10 个检出已由 benchmark PR #2 的 main 历史覆盖，另两个分别对应 benchmark 自动化工具和 Secretary 配套文档。独立 clone 同时核对本地分支、悬空提交来源，子模块检查已固定版本及未保存改动。普通依赖与缓存随已合并源码检出释放。

| 保留包 | 普通文件数 | 保留内容 |
| --- | ---: | --- |
| c16-r49、fixture-775ecdc、go-r64-cli | 3,156 | 较早的运行登记、夹具、演练和测试证据 |
| go-residual、r75-deadline、r77-integration | 370,636 | 分批运行、首次失败、子模块测试记录及诊断材料 |
| operator-evaluation | 441 | 自动化检出及其子模块的测试证据 |
| targeted-supplement | 364,801 | 原始补测、未结演练及恢复现场 |
| coordination-history | 3 | 已结束的 #79–84 协调记录和两份 #82 原生验收记录 |

共 9 个私有 NAS 包。739,037 个普通文件共 24,672,679,184 字节，压缩包合计 3,493,104,630 字节。前者是包内文件的逻辑大小。停止态根按所有者、运行记录及登记状态检查。Master 单独授权将中断现场按原状封存，该包保留 OPEN 和 RESTORING。每包先在本机创建，再逐成员从 NAS 读取并与源大小和 SHA-256 核对。首次盘点因测试目录含指向实例的符号链接而停止；后续只封存并核对链接本身。私有 RESTORE.md 记录源码版本、路径映射、校验和恢复步骤。

[benchmark PR #3](https://github.com/ExplodeCode6324/secretary-benchmark/pull/3) 以已审提交 `2e08c94` 合入 main，合并提交 `f5ac0d0` 的 [11 项 CI](https://github.com/ExplodeCode6324/secretary-benchmark/actions/runs/45994925191) 全部通过。配套的 [Secretary PR #138](https://github.com/ExplodeCode6324/Secretary/pull/138) 在首轮审查中修正了英文 v2 规则的章节归属、历史参考译文和中文同模型诊断重评的表述。已按独立操作员动作记录核对原评 684.099 秒、重评 684.648 秒。第二轮 Claude 复核在修订提交 `0b943548` 关闭三项问题。[该提交的三项检查](https://github.com/ExplodeCode6324/Secretary/actions/runs/45998105857) 通过后，PR 合入 main 的 `ebcb4b40`。[合并后 CI 回执](https://github.com/ExplodeCode6324/Secretary/actions/runs/46001114095)

已释放全部 12 个检出和已封存的历史协调目录。释放后重新列举工作区顶层，隐藏目录为零。两个仓库的 worktree 登记均无这些路径。

## 复核结论

Master 第一轮微调已落实。常规计划按验收条件拆包，标记并行、互斥和前置依赖。任务开始前若指定调度与编码分工，编码 agent 在单一 session 中完成单包，调度 agent 负责检查和验收。合并授权后核查当前 issue，有阻塞时报告并交 Master 决定是否另开会话，无阻塞时询问 Master 是否合并当前 SHA。已逐文件核对两个 checkout 的工作流正文，双方均通过 `npm run docs:check`。

此稿按 Master 要求先交本人检查。尚无本轮独立 reviewer 签署，Master 对新工作流的终审与合并决定待定。原生 ProkBot/pi 运行未执行；本轮工作没有改变产品代码或记忆机制。
