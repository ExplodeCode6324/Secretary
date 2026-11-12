# World Model / Scope 常规迭代交接

日期：2026-11-12（香港）。本文件保留计划交付时的交接记录。目录整理时：#112 已通过隔离后端验证并由 PR #115 合并；系列真实记忆与原生交互验收按 Master 要求留到全部完成后在 agile 实例进行。

## 新会话入口

Master 已将原“敏捷实例第一次迭代”改为常规迭代。请以 [中文计划](../../fix_20261112_issue111_world_model_scope.md)、[English plan](../../fix_20261112_issue111_world_model_scope.en.md) 和 [总跟踪 #111](https://github.com/ExplodeCode6324/Secretary/issues/111) 为准，在 secretary-core 开始修复前核对最新 origin/main、工作区、AGENTS 与实际运行环境。

现行计划已整理到 secretary-core 仓库内的 `docs/fix/`，使用 `fix_20261112_issue111_world_model_scope.md` 与 `.en.md` 标准命名。本目录保存交接材料、历史搬迁清单和 issue 正文快照。#112 的独立实施计划为 [中文](../../fix_20261112_issue112_world.md) / [English](../../fix_20261112_issue112_world.en.md)，验收记录位于 [issue112-world](../issue112-world/acceptance.md)。

详细执行计划已按 issue 拆分：[#112 World（中文）](../../fix_20261112_issue112_world.md) / [English](../../fix_20261112_issue112_world.en.md)、[#113 Scope（中文）](../../fix_20261112_issue113_scope.md) / [English](../../fix_20261112_issue113_scope.en.md)、[#114 Shared（中文）](../../fix_20261112_issue114_shared.md) / [English](../../fix_20261112_issue114_shared.en.md)。#112 已完成，后续领取 #113/#114 时使用对应执行计划；完整总计划及历史原文均保留。

可向后续实施会话下达（明确目标子 issue，勿重复执行 #112）：

> 按 secretary-core/docs/fix/fix_20261112_issue111_world_model_scope.md（英文版同名 .en.md）的 R5 常规迭代计划及 Secretary #111–#114 开始修复。先检查最新 main 与现有改动，再使用 codex/ 功能分支；遵循 secretary-pr-fix。完成构建后拉起隔离测试实例并留证。保护正在运行的 secretary-agile 及其所有数据。合 main 和部署持久敏捷实例分别另行确认。

## Issue 分工

| Issue | 范围 | 完整计划 |
| --- | --- | --- |
| [#111](https://github.com/ExplodeCode6324/Secretary/issues/111) | 总跟踪、常规流程、组合验收与交付 | §1、§8–13 |
| [#112](https://github.com/ExplodeCode6324/Secretary/issues/112) | World Store、角色/别名/字段、画像、召回、旧数据导入 | §3–4、§6–9 |
| [#113](https://github.com/ExplodeCode6324/Secretary/issues/113) | Main Scope 导入、精确授权、终态环境通知 | §2、§8–10 |
| [#114](https://github.com/ExplodeCode6324/Secretary/issues/114) | 默认 Shared、持久任务目录及可见性 | §5、§8–10 |

当前 #112 已实现 world.change 的受限 journal_apply 合同；#113 在此基础上增加 scope.import 专用整帧守卫，不提前开放或借用 World 守卫。Shared 可独立实现。实现切片可以调整，但不得以拆分 issue 丢失最终集成门槛。

## 计划交付时的已确认与未执行记录

- 技术方案 R5 已由指定 Fable 5.2 High 给出 PASS for plan readiness。原窄范围由 Opus 5.5 Extra PASS。不是实现、CI 或运行验收 PASS。
- Master 后续要求常规迭代；已同步改写中英文第十节及相关前后文。技术章节保持 R5，工作流调整未冒称重新复核。
- 核对时 secretary-core 为 main，HEAD `6b33008f7f1daa010a05e3386b045bcdd1a873ec`；此为本地快照，开工时刷新远端。
- 主仓库存在不属于本任务的 001 文档删除/迁往 docs/fix 的改动；敏捷仓库也有既有文档移动。未改动、暂存或恢复它们。
- 未运行产品测试、CI、构建启动、迁移；未改变运行实例、配置、数据或服务。新会话完成实现后必须实际构建并启动验收，区分自动化、真实 provider、原生 TUI、Master 手动验收。
- 常规测试可以使用独立合成 Core/PG 数据域；不得复制敏捷实例配置/凭据/真实数据来测试。敏捷实例不是本次自动部署目标。

## 数据与恢复边界

全部既有敏捷迭代数据和修复计划继续保存。未来若明确批准更新该实例，另按计划 §9–10 盘点、全量冷备份、同域非破坏性导入、首次 Settings 激活及恢复；进入首条新格式记录后不能回滚旧读者或用旧备份覆盖新写入。现在不重启、不迁移敏捷实例。

## 复核档案与搬迁校验

原始请求/回复/截图继续保存在私有忽略路径：

`/Users/muy/Desktop/secretary-agile/.local/reviews/agile-iteration-01/world-review/`

关键文件：`r5-submitted.en.md`、`r3-r5-response.txt`、`r5-fable-pass.png`、`r5-delivery-manifest.json`。搬迁前双语原稿另外保存为 `before-regular-004-first-iteration.en.md` 与 `before-regular-004-第一次迭代计划.md`，SHA-256 见 [relocation-manifest.json](relocation-manifest.json)。已验证归档后移除原敏捷 fix 目录中的本任务两份活动计划，避免两套现行版本。

复核会话链接仍在完整计划 §11–13，下一阶段使用同一指定会话，不自行替换模型。原始审阅材料、账号路径、实例标识、运行数据或凭据不上传公开 GitHub。此目录的 `issues/` 保存已发布 issue 正文快照，实际 GitHub 状态以链接为准。


`issues/` 和 `relocation-manifest.json` 保留当时发布正文及路径/哈希，不作为现行目录导航；其中旧仓库外路径属于历史记录。此次整理保留这些文件原文，现行入口以上方双语计划链接为准。
