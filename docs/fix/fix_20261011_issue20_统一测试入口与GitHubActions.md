# Issue #20：统一测试入口与 GitHub Actions

- 日期：2026-10-11
- 关联 Issue：[#20](https://github.com/ExplodeCode6324/Secretary/issues/20)
- 文档状态：待 Master 确认

## 1. 目标与基线

- 需求：[Issue #20](https://github.com/ExplodeCode6324/Secretary/issues/20)；总约束与领取顺序：[Issue #7](https://github.com/ExplodeCode6324/Secretary/issues/7)。本批是路线图第一批，无前置依赖；#8 的 API 实现已随 PR #15 合入。
- 2026-10-11（Asia/Hong_Kong）实时核对：Issue OPEN，已将 assignee 设为 `ExplodeCode6324`，由本 Codex 会话执行。
- 实际分支基线与远端 main：`9623095a34f01933feeb74995dbb4d49edc8300e`。Pi 子模块固定提交：`16787ad5b2dc748047f314ca1bfe7708f30f54f3`。
- 工作目录：`secretary-core`；分支：`codex/issue20-unified-verify`。在主工作目录继续本批工作，历史证据与未跟踪文件保持原状。
- 目标：本地与 CI 使用同一 `npm run verify`，运行类型检查、全部当前离线回归和文档检查；无 DSN 时明确计数数据库跳过，有 DSN 时实际执行数据库测试。
- 本批只改测试基础设施、必要的测试适配与使用说明。Scheduler、Authorization、Host 的后续架构工作仍归各自 issue；#19 尚未实施，本批保留有效的 issue4 回归。

## 2. 现状与原因

以下来自上述提交的源码阅读与文件盘点，尚无本轮测试结果。

| 位置                                           | 已确认现状                                                                                                                   | 对计划的影响                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `package.json`                                 | verify 为 check + runtime + issue8；issue5、issue2–4、audit 均未完整纳入                                                     | 统一离线发现与执行，避免继续手写套件链                                     |
| `tsconfig.json`                                | offline 只 include runtime、issue5、issue8                                                                                   | 扩为 `test_case/offline/**/*.ts`，保留原源码、scripts、online 的类型检查   |
| `test_case/offline/`                           | 当前套件共 52 个 `*.test.ts`：runtime 23、issue2 6、issue3 5、issue4 7、issue5 2、issue8 4、audit 5                          | 初始发现清单必须能逐项对账；清理旧测试后同步记录变化                       |
| `test_case/offline/historical/`                | 另有 7 个历史测试文件；README 明确不是当前默认回归                                                                           | 执行发现排除此归档目录，类型检查仍覆盖其中 TS；不把历史负载探针加入 verify |
| `test:review`                                  | 只运行 audit 的 4 个文件，漏掉 `world-extra.test.ts`；排除 AUD14                                                             | audit 全部进入统一发现；AUD14 排除收窄到已知用例并独立计数                 |
| 数据库用例                                     | runtime/settings、runtime/world、issue4/independent、issue8/world、audit/world-extra 共 5 个文件；源码展开后为 13 个条件用例 | PG 验收需包含 issue4 与 audit，不只补 issue8                               |
| `issue4/independent.test.ts:128` 起            | 两项 PG 用例要求 `ISSUE4_ISOLATED_POSTGRES=1` 且 socket 前缀为 `/tmp/sec-issue4-sock-`                                       | CI TCP service 无法满足；改为共享测试夹具创建独立空库的实际隔离保证        |
| `world.ts:492`、`audit/world-extra.test.ts:14` | World 扫描全部未导出 outbox；audit 会 DROP `wm` schema                                                                       | 单纯全局串行不消除残留数据；不同测试 Store 必须隔离                        |
| 旧 UI                                          | dual-ui、web、web-render 各一项 `test.skip`，源码注明 API v1 已替代                                                          | 删除已失效合同用例，保留同文件仍有效的领域与 DOM 安全测试                  |
| `.github/workflows`                            | 当前提交没有 workflow                                                                                                        | 新增 Linux 必需检查                                                        |
| `check-docs.py`                                | 检查 README/docs/test_case 链接、迁移目标及 offline 凭据引用                                                                 | 纳入 verify；失败修正文档或真实路径，不放宽检查器                          |

初始关键文件 SHA-256（实施时扩展为完整受影响文件清单）：

```text
1c9739e29258b81060d604c32948db02fd4b33a6cdfc2ce0d5b27583606bd7fe  package.json
4e40c4545184fe3c3f8dbafcb06678016356206fd66d5b92a1b671d3dde4d565  package-lock.json
5d2928999de78e971dfc2920866c1c0e60a03d54bde070dad215d9afff0a054d  tsconfig.json
e6f323d4458b5782ae2f6c2aeee06fb6dea2f64d352b2bf424379a9502f90e0b  docs/testing.md
164b42168c2a66a6088d4d0a66b4b48838de4f9cb868c7735996658626f844d2  test_case/offline/issue4/independent.test.ts
48dc419f051476c2a64eedc7de2083712592677201ec10f5322bef596662e1cb  src/pi_secretary/scripts/check-docs.py
```

## 3. 方案与修改范围

### 3.1 单一入口与测试发现

1. verify 顺序为 `check → 全部当前 offline → docs:check`。任一阶段失败返回非零；日志保留阶段名、原始失败与计数。
2. 使用一个小型 Node 脚本递归发现 `test_case/offline/**/*.test.ts`，固定排序、明确排除 `historical/`；普通 helper/worker、浏览器脚本和 benchmark 不符合入口模式。后续新套件无需追加 package.json 列表。
3. 沿用 Node test runner 与 tsx；显式限制文件并发，第一版优先确定性。保留必要的定向命令，但它们与统一入口使用相同规则，README 的默认验收只有 verify。
4. 输出发现文件数、各套件 pass/fail/skip、数据库 skip 与 AUD14 排除数。数据库用例使用统一理由 `需要 SECRETARY_TEST_DATABASE_URL`。无 DSN 是明确 skip；DSN 已配置但连接失败、建库失败或测试失败都是失败，不能降级为 skip。
5. AUD14 只排除 `audit/legacy.test.ts` 中已知的那一项名称，避免宽泛的字符串匹配隐藏未来用例。CI 要求数据库跳过为 0，允许这项明确的历史排除；二者分别报告。
6. runner 失败传播、空发现、自动纳入新文件、skip 统计用少量合成用例验证；不引入通用测试平台或额外框架。

### 3.2 类型检查与失效测试

1. 使用 `test_case/offline/**/*.ts` 覆盖当前测试、helper 及历史 TS。先冻结扩大范围后的首批诊断，再逐项修复类型和旧调用适配；不增加 `@ts-nocheck`、全局排除、宽泛 `any` 来取得通过。
2. historical 仍是历史归档，类型可检查不代表执行通过。若某归档文件已无法作为当前 TS 源保留，列明具体原因后转为清楚标记的非执行历史材料，并同步引用；不默默排除整个目录的类型检查。
3. 删除三项已退役 UI 合同测试及其独占辅助代码；保留其他有效断言。PR 列出被删除测试名称、退休原因及现有 issue8 替代范围。
4. 当前有效的业务失败保留红色证据；测试适配保持原行为断言。若确认是需要修改业务语义的新缺陷，先报告最小修复范围，不以删除或 skip 解决。

### 3.3 PostgreSQL 隔离

采用**每个数据库测试场景创建独立空数据库**，同一场景内的崩溃、重开、重试继续使用同一数据库，以保留恢复断言。

- `SECRETARY_TEST_DATABASE_URL` 作为专用测试 PostgreSQL 的建库连接；测试角色需要 CREATEDB。共享 helper 创建带本次随机标识的数据库，向该场景及其 worker 传入派生 DSN，finally 关闭连接并清理自己创建的数据库。
- 5 个数据库测试文件共用该 helper；不仅隔离套件之间，也隔离同一文件内不同 Store 的测试场景，避免残留 outbox/source_key 和 DROP SCHEMA 串扰。
- 清理对象由本次成功创建的数据库句柄确定，不清空输入 DSN 所指数据库，不按宽泛名称前缀批量删除。创建失败即终止该场景；URL、口令不进入输出。
- issue4 的 socket 路径断言改为 helper 提供的实际隔离，不仅设置一个环境变量冒充隔离；其 World receipt、只应用一次、跨崩溃恢复的断言保持。
- 无 DSN 时 helper 注册明确的条件跳过；CI 模式下缺 DSN 或任何 PG skip 直接失败。PG 用例清单与数量同时对账，防止因漏发现得到“零跳过”。
- 现有两个 Python PG 入口统一接到此执行方式，或退为明确的环境启动便捷入口；避免保留各有独立测试列表的第二套权威入口。

### 3.4 GitHub Actions

新增 `.github/workflows/verify.yml`：

- 触发 `push` 到 main 和所有分支的 `pull_request`，不加文件路径过滤。
- `ubuntu-latest`、Node 22（满足项目最低 22.19）、Python 3；checkout 初始化固定版本的 Pi 子模块，不跟踪子模块远端最新分支。
- PostgreSQL 18 service，使用健康检查和 runner 端口映射；注入仅属于该次 CI service 的测试 DSN，默认专用角色可创建临时库。
- 安装 `npm ci`，执行同一个 `npm run verify`。记录 Node/Python/PostgreSQL 版本与源码/子模块 SHA。
- job 设有界超时；只读仓库权限，不注入模型供应商凭据；依赖安装之外的测试均走 fixture。
- Linux verify 必须按实际退出状态标红，不设置 continue-on-error。Swift 解码独立可选 macOS job 按 issue 允许延后到 #10，本批不启用。
- 若仓库保护规则尚未将 verify 设为 required check，报告现状，规则变更另由 Master 决定；本批 workflow 保证故障能标红。

参考已核对的官方说明：[PostgreSQL service 与 runner 网络](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers)、[checkout 子模块选项](https://github.com/actions/checkout)。具体 Actions 版本在实施时固定并记录。

### 3.5 文档范围

同步更新 `docs/testing.md`、`test_case/offline/README.md` 及涉及默认命令的 README。说明单一入口、发现约定、AUD14、DSN/权限要求、跳过计数、数据库隔离、定向调试和 CI 触发规则。

本批没有公共 API/持久化 schema 变化，因此无预期 DTO 变化；如果测试适配暴露合同问题，先定位再决定范围。docs:check 的基线按本次干净 checkout 实测，不沿用历史错误数；缺失私密证据的链接按现有缺失附件记录规范修正，不复制私密文件到仓库。

## 4. 实施步骤

Master 确认后执行：

1. **冻结基线。** 重新核对远端 main 与 issue；初始化固定子模块、npm ci。记录环境、受影响文件散列、当前 check/各有效套件/docs:check 的首次退出状态。无 DSN 与隔离 PG 分开记录；完整执行仍在业务编辑之前。
2. **统一入口。** 类型覆盖、递归发现、明确排除与计数；适配失效测试及文档引用。
3. **接入独立 PG。** helper、五个 PG 测试文件、旧便捷入口；运行恢复与串扰回归。
4. **新增 workflow 与使用说明。** 在等价隔离环境验证完整 verify。
5. **形成提交与评审材料。** 文件差异、首次失败与修复映射、删除清单、源码净增减行数、测试汇总；公开内容仅用合成数据与脱敏结果。

## 5. 验收标准

| 验收                    | 预期                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 本地无 DSN，单次 verify | 全部当前 offline 文件进入发现，类型与 docs 检查执行；数据库 skip 明确统计，AUD14 独立列出                                       |
| 本地配置隔离 PG 18      | 当前 13 个 PG 场景均实际运行；PG skip=0；任一失败使 verify 非零                                                                 |
| 同一服务连续两轮 verify | 新建空库，结果不依赖上轮残留；正常及失败清理只影响本轮创建的库                                                                  |
| 扩大类型检查            | issue2–4、audit 和所有 offline TS 出现在编译输入；合成类型错误可使 check 失败                                                   |
| 自动发现与失败传播      | 新的合成 offline 测试自动纳入；故意失败使 verify 非零；验证后删除合成故障                                                       |
| 文档                    | docs:check 通过；单一入口说明与 package.json 一致                                                                               |
| PR CI                   | 发布获准后，在同一个临时验收 PR 的两个提交分别注入类型错误和失败断言，记录真实红色检查，再移除故障验证绿色；故障提交不合入 main |
| main CI                 | 获准合并后观察 main 的真实 workflow 成功，PG 场景执行且零 PG 跳过，再结项                                                       |

本轮授权范围截止本计划。确认计划后开展本地实现与隔离测试；推送、PR 故障演练、合并与关闭 issue 在对应阶段形成可审阅结果后办理，不预先操作。Issue #20 的远端验收在 main CI 完成前保持未完成。

## 6. 风险与回退

**中等难度，估计 1–2 人日**，不等同于代理墙钟时间。高于 issue 的 0.5–1 人日粗估，主要增加量是 PG 场景隔离、issue4 的旧 socket 假设以及新纳入类型检查的测试适配。

最大不确定性是尚未执行的全套类型/离线基线是否暴露真实业务缺陷。先按等价断言记录首败，再区分测试适配与业务缺陷；若需要超出本批范围的业务修改，向 Master 提交具体原因与计划补充。实现保持小型 runner 与单一 PG helper，不新增业务守卫、业务错误码或状态。

工作量估计包含本地实现和隔离验证。若需要回退，撤销本批测试入口、夹具与 workflow 的提交；本批不迁移业务数据。

## 7. 执行记录

- 2026-10-11：已认领 Issue #20，完成静态核查与计划。
- 2026-10-11：按 Master 要求，将分支及计划迁回 `secretary-core`，对齐最新远端 main；统一 fix 文档格式。Issue #20 实现和测试继续等待确认。
