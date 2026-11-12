## 目标与状态

将 Main 无法导入 Scope、角色身份依赖手工建实体、Shared 任务路径不明确，以及 World 事实写入/画像/召回的架构问题作为一次**常规迭代**处理。

Master 于 2026-11-12 明确：后端改造较大，退出敏捷迭代流程；本次只搬迁计划与登记 issue，由新会话开始修复。当前没有实现、测试、CI、PR、迁移或部署结论。

## 计划与复核

完整中英文 R5 常规迭代交接版位于同一工作区的 `Codex_Work/docs/fix/fix_20261112_world_model_scope/`（`plan.md`、`plan.en.md`、`README.md`）。这是 Master 指定的**本地仓库外目录**，不是 GitHub blob 路径。本 issue 和子 issue 保存公开范围及验收要求；实施时读取完整计划，尤其 §8 删除/保留矩阵、§9 数据切换、§10 常规交付和 §11–13 复核处置。

技术 R5 已获指定 Fable 5.2 High 的 **PASS for plan readiness**；此前 Opus 5.5 Extra 对较窄 Scope/身份/Shared 方案 PASS。Fable 核查部分源码，不代表独立运行验收，也未独立审阅中文版。改为常规流程是 Master 后续指示，不冒称新一轮复核。原始回复、截图和真实实例信息保留私有。

检查时本地 main 基线：`6b33008f7f1daa010a05e3386b045bcdd1a873ec`；新会话必须刷新 origin/main、工作区和子模块。

## 子项与集成顺序

- [ ] #112 World 单一持久权威、角色/别名、常驻画像和事实召回。
- [ ] #113 Main 逐次授权的 Scope 创建/目录导入与结果通知。
- [ ] #114 未指定 Scope 自动 Shared、明确持久任务目录。

World 与 Scope 共用受限 `AUTHORIZED --journal_apply--> SUCCEEDED` 内部提交边；只允许 `world.change` / `scope.import`，各自验证不同整帧约束。先定义共同合同，再分别实现。Shared 可独立修复；在同一最终版本完成组合验收。子项是职责划分，不要求将不可独立运行的中间状态拆成可合并 PR。

## 常规实施和验收

- 使用 secretary-core 的 `codex/` 功能分支和常规 PR；保护已有无关改动，不推 agile 分支、不建 agile→main PR。
- 用隔离合成数据运行针对性测试、合同生成、类型/文档及完整 required checks；允许独立的常规 Core/PG 测试实例，禁止使用敏捷实例的 DSN、数据或配置。
- 完成构建后必须实际启动验收实例。用实际 package scripts/tsx 启动验证，不能以类型检查或进程存在代替 readiness。
- World 与 Scope 授权/结果、角色和画像、固定召回题、Shared 同名文件隔离与接续、重启持久性完成组合验证；真实 provider、原生 TUI、自动化和 Master 人工验收分别给证据。
- 非空 legacy fixture 验证完整导入、重复/崩溃恢复、PG 不可达、首次 runtime Settings 激活及旧格式历史可读。
- PR 精确最终 HEAD/CI/ref 和实现复核结论一致；保留首次失败和 NOT_TESTED。合并需 Master 单独授权，合后 main CI 单列。
- 当前唯一持久敏捷实例及全部数据持续保全。本计划不自动授权迁移/重启/部署该实例；若后续获准部署，按 §9 和 §10 完整备份、同域升级、越过新记录边界后向前修复，不能用旧快照丢掉新数据。

## 完成条件

- [ ] 子项完成并链接实现及实际证据。
- [ ] 同一交付版本通过上述组合、启动与数据持久性验收。
- [ ] 正式架构/API/使用文档与生成合同同步。
- [ ] Master 终审、合并授权、合后 CI 和产品验收分别记录；未完成项不以计划 PASS 或 issue 关闭替代。

## 相邻工作边界

#6 的设备/telemetry/事件研究、#12 的通用 Scheduler EVENT 和 #70–#74 的既有 Core 优化仍按各自范围处理。本次仅为 Scope 结果审计必要 ENVIRONMENT 消费链，不扩成设备事件平台；不自动调整其他路线图排期。
