# #113 执行计划：Main 逐次授权创建与导入 Scope

日期：2026-11-12（香港）。[Issue #113](https://github.com/ExplodeCode6324/Secretary/issues/113) 当前 OPEN，尚未实施。本计划拆自 [#111 R5](fix_20261112_issue111_world_model_scope.md) §2、§8–10；技术边界不变，不冒称独立新复核。[English](fix_20261112_issue113_scope.en.md)。

## 目标、依赖与边界

Main 可提议创建 NONE 分组或导入已存在 DIRECTORY，Master 对精确参数逐次批准后才产生 Scope。结果通知触发一次独立只读报告；下一次明确 Master 输入才可委派任务。没有递归发现、任意 mkdir、模型改写/归档 Scope 或通用事件平台扩展。

[#112](fix_20261112_issue112_world.md) 已合入 main；本项复用其受限内部 `journal_apply`，增加 `scope.import` 专用整帧守卫，保留 `world.change` 无结果 Input 的语义。不要退回总计划形成时旧 World/SQL 基线。[#114](fix_20261112_issue114_shared.md) 可独立实施；最终必须验证 Shared/NONE/DIRECTORY 与导入结果一致。

## 执行顺序与实现检查点

1. **核对现有 Scope 与授权合同。** 阅读 `scopes.ts`、`authorization.ts`、`store.ts`、`main-tools.ts` 和当前输入/Operation 源定义；复用现有路径、重叠、notes、owner_epoch 与版本检查。先列出允许的 `scope.import` 参数、稳定 Operation/Scope/result ID 和整帧记录集合；从定义生成合同与接口，不给 WorkScope 增添伪造的来源字段。
2. **增加 Main 工具及提案验证。** `scope_import` 限当前 loop/同 session 的真实、未撤回、无附件 Master 事件；反馈/失败/环境轮次不可发起。规范化 name/description/kind/root_path/notes_path/default_write，DIRECTORY 默认 ask。`scope_query` 分页列活动 Scope、精确 ID 和本 session 导入状态，覆盖 prompt 列表上限，不扫描主机。
3. **逐次精确授权。** 生成 action=scope.import 的 Operation 和 24 小时授权请求；批准卡展示规范化物理路径、device/inode、写入策略、原始来源及参数摘要。明确跳过 match，拒绝 remember/通配/持久规则；批准前无新 Scope。Main/Task 不能批准自己的请求。
4. **实现同步原子应用与恢复。** 应用前重查物理目录与祖先 symlink、Core 数据/活动或占用根重叠、安全 notes、identity、证据撤回、owner epoch 和 grant 精确内容。最终检查到 commit 无 await。同帧消费 grant、创建稳定 revision=1 Scope、完成 Operation/result、写 ENVIRONMENT Input；每记录只变更一次。限定 AUTHORIZED→SUCCEEDED 内部边，不放开外部操作 DISPATCHED/RESULT_UNKNOWN 语义。
5. **处理无效果失败与终态协调。** 路径替换/冲突等确定失败同帧取消 Operation(effect=NOT_STARTED)、作废 grant、写失败 Input，不创建 Scope。在线 pump 与启动协调拒绝/撤销的缺失通知；PENDING/未消费 APPROVED 真正超时才 EXPIRED，同帧取消 WAIT_AUTH/AUTHORIZED 并写结果。成功/已消费跳过，稳定去重键 `scope-import-result:<operation_id>`；版本裁决批准/撤销/到期竞争，不倒退已提交效果。HOST 原因如实显示，保留原 approver，不假称 Master 撤销。
6. **隔离 ENVIRONMENT 报告轮次。** `main-loop` 按原输入顺序分批，不与新 Master 输入混合；仅允许读/查/报告。把失败处理和通知工具限制都改为明确 allowlist，禁止导入、World 变更和新 Task。BASE_SYSTEM 说明通知不是授权；模型调用是产品成本。保留结构化 FAILURE_SYSTEM 和原有上下文/快照预算。
7. **审计全部来源消费者及 UI。** 检查 main-loop 准入/actor/活动、main-tools、input-origin/projection、settings-memory/memory-extraction、historical-inputs、memory-search、conversation/timeline、activity/attention、附件。`input.accepted` 明确 HOST，不能落 SCHEDULER 默认或在摘要中升格 Master；无需伪 Task/Execution/Feedback。TUI 通用 attention/详情与 owner API 展示相同精确参数和终态。

## 必须完成的隔离测试矩阵

| 场景 | 可观察断言 |
| --- | --- |
| NONE / DIRECTORY 提案、批准与查询 | 批准前零 Scope；批准后一条稳定 Scope 和回执；DIRECTORY 默认 ask；分页能查 prompt 外项目 |
| 无效来源、其他 session、撤回、附件、失败/环境轮 | 不创建可绕过的授权或 Scope；ENVIRONMENT 不能成为 World guideline/Master 证据 |
| symlink 祖先、相对路径、根替换、重叠、unsafe notes | admission 与 apply 两阶段均覆盖；device/inode 改变使旧批准无效；提示 macOS /tmp、/var 使用真实路径 |
| 拒绝、撤销、24h 到期、STALE_OWNER、参数变更 | 无错误 Scope/重复 grant 消耗；HOST 原因正确；在线超时不是仅 UI 隐藏 |
| 相同 ID 重试、同 ID 改内容、并发决定 | 重试同结果，改内容拒绝，版本确定竞态顺序；成功后不倒退 |
| commit 前/后 crash，决定后通知前 crash | 重启不重复建 Scope；终态通知恰好一条；无重启也能 pump 补齐 |
| 环境结果与新 Master 输入相邻、失败处理 | 保序隔离；报告轮工具仅白名单；新 Master turn 才能委派；旧失败结构不丢 |
| World 与外部 Operation 回归 | World 仍无自动唤醒；动作整帧守卫不互借；外部效果边不被绕过 |

先扩展既有 `test_case/offline/issue16/scopes.test.ts`、`issue25/transitions.test.ts` 和 Main/授权测试；专用 #113 测试文件在实施时按仓库结构建立。对关键帧做真实进程中断/重启而非只验证内存结果。用隔离测试数据根外的持久 DIRECTORY 根，记录首次失败与路径清理归属。后续 agile 组合验收再覆盖真实终端批准、通知报告和新 Master turn 委派闭环，不能以 API PASS 冒称 native PASS。

## 验证、交付与数据边界

执行时先刷新 `origin/main`、核对工作区及项目说明，使用独立 `codex/` 分支。先验证针对性回归，再运行生成合同/文档检查、`npm run verify` 和 required Linux/macOS CI；生成文件从源定义更新。记录候选 HEAD、CI 实测 head/merge SHA/tree、首次失败及修复依据。构建/类型检查后实际启动隔离 Core；使用独立合成数据域、回环端口和专用 `secretary_test_*` 数据库，检查 readiness，而不以进程存在代替就绪。不得向测试清理工具传入 agile 路径或 DSN。

按 secretary-pr-fix 在原指定 Claude 会话复核最终实现，区分 reviewer 源码结论、自动化/API、真实 provider、原生 TUI 和 Master 验收。逐项记录 PASS/FAIL/NOT_TESTED。Master 已将本系列真实记忆和原生交互组合验收留到全部完成后在 agile 进行；隔离后端测试仍必须完成，不能用空实例代替非空合成数据验证。当前文档拆分不代表新一轮技术复核，也不代表 #113/#114 已获实现或合并授权；实现交付按 Master 当时指令执行，合并后确认 main CI。

保护正在运行的 agile 及全部 journal/CAS/数据库/任务目录/配置，当前任务不部署、不重启、不复制真实数据。未来部署另经明确授权，按总计划 §9–10 盘点待处理状态、静止写入而不取消任务、验证全量冷备份、保留同域身份并执行非破坏性升级及 readiness 检查。跨新格式 journal 边界后只向前兼容修复，不用旧备份覆盖新写入。#111 保留组合验收及跨 issue 数据恢复门槛。

## 保留的 R5 技术合同

以下逐字摘录总计划对应章节，保留原节号；它们是技术要求，不是新增测试证据。公共交付/恢复要求仍见总计划 §8–10。未来若 Master 调整方案，总计划与对应子计划同步修改。

## 二、Main 的 Scope 导入

增加 Main 专用 `scope_import` 与只读 `scope_query`。支持创建 NONE 分组，或导入已存在的 DIRECTORY；本轮不做递归扫描、任意创建主机目录、模型修改/归档已有 Scope。

导入需有本轮同会话、未撤回、无附件的 Master 原文证据，复用来源分类校验；授权请求有效期 24 小时，到期只失效不删除历史。每次模型导入必须产生 `scope.import` Operation 和精确参数授权请求，目录默认 `default_write=ask`。Master 在现有授权界面批准后才生效；不允许持久规则、通配规则、记住授权或模型自行批准绕过。展示规范化路径、写入策略、来源事件与参数摘要。反馈、定时器及失败处理轮次不得自行开启此类变更。

提议和应用时都检查：绝对且存在的物理目录、祖先无符号链接、与 Core 数据/活动及仍占用目录无冲突、notes 相对路径安全；记录并复查目录设备/inode，替换后旧批准失效。说明现有文件路径检查的竞争窗口限制，不能宣称完全消除了主机文件系统竞态。

使用 operation 派生的稳定 scope ID。新增仅对 `scope.import`、`world.change` 开放、分别校验所需变更组合的 `AUTHORIZED --journal_apply--> SUCCEEDED` 状态边；Store.stage 校验同一帧包含精确批准的 grant 从 APPROVED 到 CONSUMED、revision=1 的稳定 Scope、Operation 成功/回执事件和完成 Input。每条记录只修改一次；其他外部操作不可使用此边。最终文件系统检查至提交之间不 await。提交前崩溃仍待应用，提交后回放同一结果。

应用时发现路径替换/冲突等确定无效果失败，则同帧把 Operation 取消、effect=NOT_STARTED、批准作废（HOST 原因；仅实际到期才标 EXPIRED）并保存失败通知；不创建 Scope。批准/撤销竞争由版本检查串行裁决，提交后不能以撤销倒退已经完成的效果。显式跳过 match()，拒绝 remember 与此动作的持久规则。来源通过事件/Operation 关联表达，不增加 WorkScope 存储字段，不伪造 MASTER_UI。

完成通知复用 `Input.producer=ENVIRONMENT`，稳定去重键 `scope-import-result:<operation_id>`，携带结果和原 Master 事件引用，以 HOST 审计；成功/应用失败通知同帧落盘。owner 路径拒绝/撤销/到期后，由每次 pump 和启动时运行的幂等协调步骤补齐恰好一条终态通知，正常运行即可送达，重启亦可恢复。不能冒造 Task/Execution 来套用 Feedback。该 Input 唤醒 Main 做查询和报告；独立轮次仅允许读/报告，不能导入、改实体或创建 Task，下一次明确 Master 输入才可委派到新 Scope。在 main-loop 的批次边界按原有输入顺序隔离该通知，不能与新 Master 输入混批；BASE_SYSTEM 明确 ENVIRONMENT 通知不是 Master 授权。

将失败处理工具限制由黑名单改为明确白名单，避免新增变更工具默认放行；完成通知也采用读/报告白名单。scope_query 仅提供分页活动 Scope、精确 ID 和本会话导入状态，覆盖 prompt 列表上限之外的项目，不扫描文件系统。错误说明 macOS /tmp、/var 为符号链接时须提供真实路径。新增 HOST 到期步骤，每次 pump 和启动时检查 scope.import：超出 expires_at 的 PENDING 或未消费 APPROVED grant → EXPIRED，同帧取消 WAIT_AUTH/AUTHORIZED Operation、effect=NOT_STARTED、写入明确到期结果 Input。已消费/终态跳过，通知只生成一次；拒绝/撤销后的缺失通知在下次 pump 补齐，不等重启。到期不能只从界面消失却永留 WAIT_AUTH。决定/到期/应用由版本和同步事务裁决。decided_by 保留原 MASTER_UI 批准者或 null，HOST 作废原因写审计及 UI，不显示成 Master 撤销。journal_apply 还必须检查 owner_epoch，拒绝 STALE_OWNER。MasterAttention/TUI 已支持 Main 授权，实施时验证整条链路。

## 实施记录（2026-11-12）

Master 已授权评估后直接实施、提交 PR/CI，并指定 Claude Fable 5.2 Medium 复核。基于 main `0fc46dd8509e270c58d31afbeb4dfd6c2b462d67`（已合入 #112）评估，R5 合同继续适用；分支为 `codex/issue113-scope-import`，#113 已分配并领取。原仓库外计划目录已不存在，本仓库保留的完整 R5 与子项计划作为当前交接依据。沿用原 Claude 会话，界面已核实 Fable 5.2 Medium。

实现包括 Main 导入/分页查询、逐次精确授权与证据展示、Scope 整帧原子校验和结果 Input、pump/启动恢复及在线到期、通知只读轮次与来源消费审计。WorkScope 不添加伪造来源字段，不需要新增 owner API 路由；内部参数由 `src/contracts/contracts.schema.json` 生成，现有通用授权/Scope DTO 保持有效。macOS CI 显式纳入 #113 测试。

首次失败私有留存：类型检查发现工具 label 和独立 schema 类型导出缺失，已修复生成器；过期 owner 测试最初用了合同禁止的 epoch 0，已改为合法但不匹配的值；闭环测试误查不存在的 Task 记录，已改查实际 TaskPlan。未使用生产数据、provider 凭据或敏捷实例配置/服务；隔离测试 PG 使用本任务独占的临时目录和 loopback 端口。原生 TUI、真实 provider 和 #111 敏捷组合验收仍按 Master 系列决定记为 NOT_TESTED/延后。冻结代码后在 PR 记录最终测试、精确 SHA/CI 和复核结论。
