# #114 执行计划：默认 Shared 与可见的持久任务目录

日期：2026-11-12（香港）。[Issue #114](https://github.com/ExplodeCode6324/Secretary/issues/114) 当前 OPEN，正在 `codex/issue114-shared-workspaces` 实施。拆自 [#111 R5 总计划](fix_20261112_issue111_world_model_scope.md) §5、§8–10；范围与已复核合同不变。[English](fix_20261112_issue114_shared.en.md)。

## 目标与依赖

省略或显式 null 的 scope_id 统一选择内建虚拟 Shared；每个 Task 有独立持久目录，接续沿用，用户能查到 Core 主机上的真实位置。wire 继续使用 `scope_id=null`，不新增普通 WorkScope 代替 Shared，不搬迁历史文件或回写不可变 Execution 绑定。

本项可以独立于 [#113 Scope 导入](fix_20261112_issue113_scope.md) 开发，实施前刷新已含 [#112 World](fix_20261112_issue112_world.md) 的 main；最终在同一版本验证新导入 DIRECTORY、显式 NONE 和 Shared。没有清理/归档策略扩展或 Scope 级公用工作目录。

## 执行顺序与实现检查点

1. **盘点入口和既有绑定。** 从 `scopes.ts`、`task-planning.ts`、`task-triggers.ts`、`execution-runner.ts`、`store.ts`、`artifact-path.ts` 追踪 Main/API、AGENT/PROGRAM 的 admission、执行绑定、接续与产物路径。区分新任务未绑定、已有任务绑定和历史缺目录，不把推导路径当已存在目录。
2. **统一 Scope 解析。** 省略/null 解析为虚拟 Shared；显式无效、已归档或不可用 ID 报错，不能降级。NONE 保持独立命名分组，DIRECTORY 保持批准外部根。复用统一 resolver/projector，覆盖 admission/query/browser/prompt/packet，避免入口各自解释 null。
3. **固定 Task 级目录和接续。** Shared 每 Task 用 `data/core/workspaces/<task_id>/work`；同 Task 各 Execution 沿用原绑定，不随接续重新选 Scope。NONE 保持其独立目录语义，DIRECTORY 用批准根。复用已有目录安全及占用检查；不改写历史 Execution 或为已绑定但丢失的目录创建空目录掩盖错误。
4. **提供诚实的路径投影。** 视图明确 `scope_kind=SHARED`、`scope_name=Shared`，保留 null wire 兼容。task_query、详情 API/TUI、执行上下文、结果及相关产物视图展示 Core 主机绝对路径、根类型、可用状态和 Scope 名称。未绑定推导路径标“计划位置”，只有实际创建/检查后标已验证；缺失/不安全显示可诊断错误。
5. **更新 Main 与远程呈现。** 无任何普通 Scope 时 prompt 仍解释 Shared 默认值；工具回执与任务分组/查找/排序保持一致。明确路径位于 Core 主机；/open 沿用现有安全限制，不把别的 Task 路径当可访问目录。CAS 固定交付、历史附件/产物引用和 TUI 导航语义保持兼容。
6. **生成合同与文档并联调。** 从源定义更新必要 DTO/公共 schema/投影/文档/本地化；验证旧客户端省略/null 和旧 Execution 数据解码。完成/退役后工作区仍保留；重启恢复不迁移、不删除、不重新绑定。与 #113 的 DIRECTORY 导入后委派和 #112 的重启恢复一起验证。

## 必须完成的隔离测试矩阵

| 场景 | 可观察断言 |
| --- | --- |
| 零普通 Scope 的新域 | Main/API × AGENT/PROGRAM × 省略/null 均选择 Shared，返回一致名称/类型和正确路径状态 |
| 显式无效/已归档/不可用、NONE、DIRECTORY | 错误 ID 不降级；三种有效根语义不同且正确；无任意换绑 |
| 两个 Shared Task 同名文件 | 写不同内容且目录不同，读取及产物内容各自正确；不存在共享工作区覆盖 |
| 同 Task 接续及 Core 重启 | 接续读取原文件，Task/Scope/目录/Execution 历史绑定及 CAS 引用一致 |
| 未绑定、已验证、丢失或不安全目录 | planned/verified/错误状态准确；历史丢失不创建伪恢复目录；不安全路径拒绝 |
| 接续改 Scope、跨 Task 路径与 /open | 拒绝换绑和越界访问，保留现有安全边界与固定 CAS 交付 |
| 完成/退役及历史恢复 | 工作区保留；历史数据不被规范化重写，旧缺失状态可诊断 |
| query/API/TUI/prompt/packet 一致性 | 无 Scope 时仍提示 Shared，远程明确 Core 主机路径；列表、详情、导航、产物一致 |

优先扩展 `test_case/offline/issue16/workspace.test.ts`、`scopes.test.ts` 及既有任务接续/产物测试；再按需增加 #114 回归。至少用两个非空合成任务和受控停止/重启验证文件字节与绑定；保留失败证据。自动化 API/TUI 投影检查与原生键盘操作分开标记；真实记忆及原生组合验收按 Master 决定后置。

## 验证、交付与数据边界

执行时先刷新 `origin/main`、核对工作区及项目说明，使用独立 `codex/` 分支。先验证针对性回归，再运行生成合同/文档检查、`npm run verify` 和 required Linux/macOS CI；生成文件从源定义更新。记录候选 HEAD、CI 实测 head/merge SHA/tree、首次失败及修复依据。构建/类型检查后实际启动隔离 Core；使用独立合成数据域、回环端口和专用 `secretary_test_*` 数据库，检查 readiness，而不以进程存在代替就绪。不得向测试清理工具传入 agile 路径或 DSN。

按 secretary-pr-fix 在原指定 Claude 会话复核最终实现，区分 reviewer 源码结论、自动化/API、真实 provider、原生 TUI 和 Master 验收。逐项记录 PASS/FAIL/NOT_TESTED。Master 已将本系列真实记忆和原生交互组合验收留到全部完成后在 agile 进行；隔离后端测试仍必须完成，不能用空实例代替非空合成数据验证。当前文档拆分不代表新一轮技术复核，也不代表 #113/#114 已获实现或合并授权；实现交付按 Master 当时指令执行，合并后确认 main CI。

保护正在运行的 agile 及全部 journal/CAS/数据库/任务目录/配置，当前任务不部署、不重启、不复制真实数据。未来部署另经明确授权，按总计划 §9–10 盘点待处理状态、静止写入而不取消任务、验证全量冷备份、保留同域身份并执行非破坏性升级及 readiness 检查。跨新格式 journal 边界后只向前兼容修复，不用旧备份覆盖新写入。#111 保留组合验收及跨 issue 数据恢复门槛。

## 保留的 R5 技术合同

以下逐字摘录总计划对应章节，保留原节号；它们是技术要求，不是新增测试证据。公共交付/恢复要求仍见总计划 §8–10。未来若 Master 调整方案，总计划与对应子计划同步修改。

## 五、默认 Shared 与持久任务目录

将 Shared 明确为内建虚拟 Scope，统一 admission/query/browser/prompt/packet 的解析和展示；保留 `scope_id=null` 兼容已有数据/API，并在视图增加 `scope_kind=SHARED`、`scope_name=Shared`。省略/null 自动选 Shared；显式无效或已归档 ID 报错。AGENT/PROGRAM、Main/API 入口一致；接续继承既有 scope，不允许换绑。

Shared 的每个 Task 独立使用 `data/core/workspaces/<task_id>/work`，接续保持同一路径。NONE 仍是独立命名分组；DIRECTORY 使用批准的外部根。不能把 Shared 改成所有任务共用一个目录，不能迁移/回写历史 Execution 的不可变绑定。

没有任何普通 Scope 时也向 Main 说明默认 Shared。task_query、详情 API/TUI、执行上下文与相关产物视图提供 Core 主机绝对路径、根类型、可用状态及 Scope 名称；尚未绑定的推导路径标作“计划位置”，不能冒充已验证目录。远程客户端明确这是 Core 主机路径，沿用 /open 安全限制。旧目录缺失/不安全要报错，不用新空目录掩盖。保持 CAS 固定交付及既有历史；完成/退役不删除工作区，也不把其他任务路径当成本任务可访问目录。


## 实施记录（2026-11-12）

Master 已授权评估现有计划后直接实施，并要求测试、PR、CI 和 Claude Fable 5.2 Medium 复核；前置条件是 #113 合并。已实时确认 PR #116 合并为 `1efcc9f96737bd1034dc5d0f29d067093f89854c`，合后 CI `43203003127` 的 Linux、macOS 和汇总检查通过。本地干净 main 与之相符，子模块版本未变。已领取 #114，使用 `codex/issue114-shared-workspaces`；沿用既有 R5 范围，不重复要求计划批准。

Scopes 统一 Scope 标签和工作目录只读投影，Shared 保持 null 身份；显式不可用 Scope 拒绝准入。Main 总是说明 Shared 默认。query/准入回执、API task/execution/result 详情、Task 浏览详情和执行包增加 `workspace_info`，明确 CORE_HOST。未绑定为 planned，已绑定经本次检查为 verified，缺失或不安全为 unavailable。历史普通 Scope 引用不存在时保留原 ID 和不可用标签，不降级 Shared；未知路径/类型可为 null。保留 #16 的 owner 修改 DIRECTORY 后影响未来执行的行为及历史绑定不可变性。

绑定不再补建遗失的私有目录。仅既有 DIRECTORY 首次转 NONE、从未有私有执行时可新建；初始化写入前检查 symlink 祖先。不迁移历史/CAS，不删除数据、不新增清理策略、不访问敏捷实例、不部署、不合并。

首次失败均保留：新测试使用了不存在的命令/结果路由（修正测试入口）；API 通用投影过滤保留字 workspace（改用类型化 workspace_info，保留原过滤规则）；完整检查遇到历史 fixture 引用不存在的 Scope（修复读取诊断，未放宽准入）；终端测试暴露 macOS /var 别名与 Scheduler 物理路径不一致（计划路径统一用物理 Core 根）。48 项定向检查原为 47 通过、1 项终端失败，修正后该项 1/1 通过。13 项 Shared/Main/PROGRAM/保留测试通过，并增加终端投影回归。完整检查已在历史兼容与路径修复后重启；最终测试、精确 HEAD CI 和 reviewer 结果在 PR 记录，当前不冒称完成。

隔离 PostgreSQL fixture Core 已用真实 package scripts 启动，达到 IDLE 且 World supported；两个已批准 PROGRAM 任务经 HTTP 写入同名不同内容文件。受控重启/接续验证进行中。自动终端渲染不等于原生键盘验收。真实 provider、原生 TUI 及 #111 敏捷真实记忆组合验收按既定决定保留 NOT_TESTED/延后；未修改敏捷配置、数据或进程。原始复核与首次失败等证据位于忽略目录 `.demo-data/issue114/`。


## Master 范围修订：旧 Scope 外任务硬切换

#114 实施期间 Master 明确要求兼容问题硬切换：目前无需要保留的正式数据，旧 Scope 外任务数据可直接丢弃。本修订取代该类旧任务的兼容/保留要求；新实现创建任务的持久性、隔离和缺目录诊断要求仍有效。不增加迁移适配、虚构 Scope 或容错悬空 Scope 投影。初版兼容分支已撤销，显式 Scope 缺失仍为 SCOPE_NOT_FOUND；分页 fixture 改为通过正式准入创建真实 NONE Scope，原过滤、分页和 cursor 断言全部保留。本次源码修改未部署或清理既有实例。按修订后的源码重新运行完整检查；之前中断的运行仅作首次失败证据，不计最终 PASS。


### 接续预算回归

修订后完整检查发现 #21 S2 因新增 Shared 提示触发 CAPACITY_BLOCKED（input 54123，usable 54067）。前两次精简虽让首请求通过，但仍无足够空间返回最小记忆页，原非空页断言继续失败。最终去掉零 Scope 的冗余空列表封装并压缩 task_propose 文字，保留全部指示；未改上下文上限、reserve、分页断言、输入 fixture 或 memory 工具预算规则。最终 #21 read 和 #114 定向回归 17/17、类型检查和文档检查通过，随后重启完整检查。首次失败原始证据保留。


### Claude 实施 R1 处理

Fable 5.2 Medium 要求修改：定时 DIRECTORY 任务首次执行前改为 NONE 时，因未初始化私有目录进入 WAIT_PRECONDITION。新增回归在修复前复现了相同失败。现在每个新任务均一次性初始化私有目录，包括 DIRECTORY 任务；DIRECTORY 执行仍只绑定批准的外部根目录。绑定阶段不创建目录，也不扫描历史执行。两处 #16 断言按明确变更后的初始化契约改为目录存在；外部目录执行、不可变绑定、授权和 CAS 断言保持不变。既有排队/历史缺目录及 symlink 检查仍严格拒绝。本修订取代此前首次切换时创建目录的补丁；依 Master 硬切换决定，无须为旧数据增加兼容适配。

首轮复核独立执行定向测试 67/68 通过；唯一 frozen-wrapper SIGKILL 在复核沙箱中的旧基线上也复现，单列为环境问题。最终验证及精确 head 复核结果记录在 PR，不将该轮部分结果算作最终批准或完整测试通过。
