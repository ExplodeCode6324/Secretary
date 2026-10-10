# Issue #20：统一测试入口与 GitHub Actions

- 日期：2026-10-11
- 关联 Issue：[#20](https://github.com/ExplodeCode6324/Secretary/issues/20)
- 文档状态：待验收（本地实施与验证完成，待 Master 审查）

## 1. 目标与基线

- 需求：[Issue #20](https://github.com/ExplodeCode6324/Secretary/issues/20)；领取顺序和共同约束：[Issue #7](https://github.com/ExplodeCode6324/Secretary/issues/7)。本批无前置依赖；#8 的 API 实现已随 PR #15 合入。
- 2026-10-11（Asia/Hong_Kong）核对：Issue OPEN，assignee 为 `ExplodeCode6324`。审查来源：[Claude 对本计划的完整评论](https://github.com/ExplodeCode6324/Secretary/issues/20#issuecomment-6103200256)。
- 业务代码基线与当日远端 main：`9623095a34f01933feeb74995dbb4d49edc8300e`；本次修订起点为仅增加计划和文档整理的 `1f17b4f3a5127e35ec5e8e9b1cdff7701f928325`。Pi 子模块固定提交为 `16787ad5b2dc748047f314ca1bfe7708f30f54f3`。
- 工作统一在 `secretary-core` 主工作目录及 `codex/issue20-ci-implementation` 分支进行，fix 文档统一放 `docs/fix/`，不另建独立工作区。
- 目标：本地和 CI 使用同一 `npm run verify`，执行类型检查、文档检查和全部当前离线测试；本地缺 DSN 时明确跳过数据库测试，CI 缺 DSN 时直接失败。
- 范围限于测试入口、必要测试适配、CI 和文档。#19 尚未实施，本批保留 issue4 的运行回归；Host、Scheduler、Authorization 和 Context 业务语义留给后续 issue。

## 2. 现状与原因

以下保留实施前的基线核查；实际实现和验证结果见第 7 节。

| 位置                                | 已确认现状                                                                                  | 处理                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `package.json`                      | verify 只含 check、runtime 和 issue8                                                        | 改为 check、docs:check、全部当前 offline                     |
| `tsconfig.json`                     | offline 只 include runtime、issue5、issue8                                                  | 扩至当前 offline，issue4 允许有期限的特例                    |
| `test_case/offline/historical/`     | 旧接口探针与历史负载脚本，不属于当前回归                                                    | 整体移到 `test_case/historical/offline/`，不运行、不类型检查 |
| `test:review`                       | 手工列举文件，漏掉 audit/world-extra，按 AUD14 名称排除                                     | 使用原生 glob；AUD14 改为原生 todo                           |
| PG 测试                             | 分布在 runtime/settings、runtime/world、issue4/independent、issue8/world、audit/world-extra | 全部接入同一个临时库 helper，不维护固定场景数量              |
| `issue4/independent.test.ts:128` 起 | 两处 PG 场景依赖旧环境标记与固定 Unix socket 前缀                                           | 只做共享 helper 接入，保留恢复断言                           |
| `world.ts:492` 与 audit/world-extra | 全量扫描未导出 outbox，audit 会 DROP wm schema                                              | 每个场景使用独立空库，避免跨 Store 串扰                      |
| `context.ts:148`                    | tools_schema 保存 system 消息数组；AUD14 却按顶层工具定义读取                               | 保留断言并标 todo，跟踪字段语义与编码问题                    |
| 旧 UI                               | dual-ui、web、web-render 各有一项已退役的 test.skip                                         | 删除失效合同用例，保留有效领域与 DOM 测试                    |
| PG Python 入口                      | test-postgres.py 与 audit/run-world.py 各维护一套测试列表                                   | 删除两个当前入口及对应使用命令                               |
| CI 与文档检查                       | 没有 workflow；docs:check 尚未纳入 verify                                                   | 增加 workflow，文档检查先于测试                              |

## 3. 方案与修改范围

### 3.1 使用 Node 原生测试入口

1. verify 为 `npm run check && npm run docs:check && npm test`，便宜的检查先失败。
2. `npm test` 直接使用 `tsx --test "test_case/offline/**/*.test.ts"`。glob 用双引号交给 Node 处理；新增当前离线测试按 `*.test.ts` 命名即可自动纳入。不编写自定义 runner、reporter、发现脚本或它们的合成测试。
3. 使用 Node 原生 pass/fail/skip/todo 汇总和退出码。PG skip 附明确原因，在原生输出中可定位；不额外解析或按套件重新计数。
4. 保留确有调试用途的定向命令；`test:review` 使用 audit 的 glob，不再列举文件或带 `--test-skip-pattern`。统一验收入口仍只有 verify。
5. Node 22 的官方文档已确认 glob 与 todo 语义；CI 使用 22 系列且满足项目最低 22.19，实施验收记录实际版本。当前修订只核对文档，不把 Claude 的 Node 22.22 实测写成本会话实测。

### 3.2 归档、类型范围与退役测试

1. 将 `test_case/offline/historical/` 整体移到 `test_case/historical/offline/`，保留历史材料。同步 Markdown 引用、`docs/migration-map.json` 及必要目录说明；归档不进入当前执行和类型检查，不适配旧接口、不恢复为第二套入口。
2. tsconfig 的当前测试范围使用 `test_case/offline/**/*.ts`，保留原源码、scripts、online 范围。不增加 `@ts-nocheck`、宽泛 `any` 或无期限的整体排除。
3. issue4 只适配两处 PG 场景。若扩大类型检查后该组报错较多，允许显式临时排除 `test_case/offline/issue4/**`，在 tsconfig 注释和 testing 文档注明“随 #19 删除”；不为即将删除的测试做成组类型改造。排除仅作用于类型检查，运行 glob 仍执行 issue4。实施时检查是否有其他已检查文件导入它，避免误以为 exclude 能屏蔽传递导入，也不扩大排除范围。
4. 删除已退役的三项 UI 合同测试及其独占辅助代码。PR 列出删除名称、原因及现有 issue8 替代范围；同文件的有效断言保留。
5. AUD14 原回调和断言保留，增加 `{ todo: "tools_schema 当前保存 system 消息；#19 删除恢复哈希消费者，#24 处理 Context 字段语义与编码" }`。它照常运行，由 Node 单列 todo，不影响 verify 退出状态。其他用例不得借此豁免。
6. 源码已确认字段值与 AUD14 的顶层读取假设不一致；system 消息是否还嵌套工具信息不在本轮作运行结论。当前源码中该字段哈希的业务读取位于 memory-extraction-recovery.ts，#19 已计划删除这套恢复机制；字段本身跟随 #24 的 Context 编码工作复核。

### 3.3 PostgreSQL helper 与清理

采用**每个数据库测试场景一个独立空库**。同一场景内崩溃、重开和重试继续使用同一库，保留恢复语义。

- `SECRETARY_TEST_DATABASE_URL` 只用于连接专用测试 PostgreSQL，角色具备 CREATEDB；helper 用 `secretary_test_` 加随机标识建库，向场景及其 worker 传递派生 DSN。finally 关闭连接，清理本场景实际创建的库。
- 当前和新增 PG 测试统一通过 helper 注册。注册时缺 DSN：本地返回带原因的 skip；CI 模式直接抛错，不能在调用 helper 之前用 skip 绕过检查。workflow 显式设置 `CI=true`。
- 已配置 DSN 后，连接、建库或用例失败均按失败处理，不降级为 skip。不硬编码 PG 用例总数，不增加统计或对账机制。统一 glob 和 helper 接入约定负责发现与执行；helper 的缺 DSN 检查负责消除静默跳过，不把它当作发现所有测试的独立证明。
- issue4 去掉旧 socket 路径与环境标记断言，改用 helper 实际分配的空库；World receipt、只应用一次及跨崩溃恢复断言保留。
- 删除当前的 `test_case/offline/test-postgres.py` 和 `test_case/offline/audit/run-world.py`。本地使用已有专用测试 PG，CI 使用 service container；实施时核对本地版本与测试角色，不启动另一套临时集群。Python 3 仍是 journal 锁助手依赖。
- 自动清理只操作本场景创建的库。Ctrl-C 或进程被杀后可能留下库，提供显式手动命令 `npm run test:db:clean`：只读取专用测试 DSN，默认列出候选库，追加 `-- --apply` 才删除。
- 手动清理精确匹配字面前缀 `secretary_test_`，只处理测试角色拥有且没有活动连接的库，排除当前连接库与模板库；有活动连接则保留并提示，不强断其他正在运行的测试。SQL 标识符正确转义，DSN 和口令不输出。

### 3.4 GitHub Actions

新增 `.github/workflows/verify.yml`：

- 触发 main 的 push 和所有分支的 pull_request，不设路径过滤。
- ubuntu-latest、Node 22、Python 3；checkout 初始化仓库固定 Pi 子模块，不跟踪子模块最新分支。Actions 固定版本并在提交中可审阅。
- setup-node 显式配置 `cache: npm`、`cache-dependency-path: package-lock.json`；缓存 npm 下载数据，仍执行 npm ci。
- PostgreSQL 18 service 配健康检查与 runner 端口映射，提供该次 CI 专用 DSN；测试角色可创建临时库。
- 执行 npm ci 和同一 npm run verify；记录实际环境版本、源码提交与子模块提交。
- 只读仓库权限、有界 job 超时、不注入模型凭据。Linux verify 不设 continue-on-error；Swift 可选 job 延后到 #10。
- main 首次通过后，报告 verify 是否为 required check；分支保护由 Master 决定。workflow 标红与保护规则阻止合并是两项不同能力。

参考：[Node 22.22 官方 test runner 文档](https://raw.githubusercontent.com/nodejs/node/v22.22.0/doc/api/test.md)、[setup-node 缓存说明](https://github.com/actions/setup-node)、[PostgreSQL service](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers)。

### 3.5 文档与基线记录

更新 docs/testing.md、offline README、归档目录说明、迁移映射及涉及命令的 README，说明统一入口、todo、临时类型排除、专用 DSN、手动清理和 CI。

基线记录源码 commit SHA、固定子模块 SHA、环境版本和首次失败日志即可，不再列逐文件 SHA-256。对尚未提交的工作用 git diff 记录差异，验证结果写明对应提交或工作树差异。本批没有预期公共 API、DTO 或持久 schema 变化。

当前主工作目录的既有本地报告快照会产生 docs:check 断链，上一轮文档整理前后均为 17 项，提交文件集检查通过。实施时重新定位；保留私密材料，修正本地快照布局或引用，不放宽检查器、不为通过而公开原始证据，也不把历史数量作为门槛。

## 4. 实施步骤

Master 已批准按以下步骤执行：

1. **记录基线。** 重新核对远端 main、issue、源码提交及工作树差异；初始化固定子模块、npm ci。保留现有 check、docs:check、当前有效离线套件的首次结果，数据库测试使用专用隔离环境。
2. **收敛入口。** 迁出 historical，更新引用，使用原生 glob 和汇总；扩大当前测试类型范围，按条件处理 issue4 临时排除；AUD14 改 todo，删除三项退役 UI 测试。
3. **统一 PG。** 接入共享 helper，最小适配 issue4，删除两个 Python 入口，补手动清理命令。
4. **交付 CI 与文档。** 配置 service、npm 缓存和 verify，完成本地等价隔离验收，记录失败与修复。
5. **形成评审材料。** 提交范围、测试删除及类型排除理由、实际验证日志、源码净增减行数。推送、PR 故障演练、合并及结项在相应阶段办理。

## 5. 验收标准

| 场景                 | 预期                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| 本地无 DSN 的 verify | check、docs:check 先执行；当前离线套件由 glob 纳入，PG 明确 skip，AUD14 单列 todo                               |
| CI 模式缺 DSN        | helper 直接失败，verify 非零；不能以 skip 完成                                                                  |
| 专用 PG 18 的 verify | PG 用例实际执行、不因 DSN 跳过；连接或建库错误使 verify 非零                                                    |
| 隔离与正常清理       | 同一服务连续运行互不依赖残留数据；不同场景独立，同场景重开复用；finally 只清理自己创建的库                      |
| 手动孤儿库清理       | 默认只列候选；显式 apply 只删除本角色无活动连接的匹配库，保留非前缀库、连接库与其他活动测试库                   |
| 类型检查与归档       | 当前 offline 在范围内；historical 不进入执行或类型检查；若启用 issue4 临时排除，理由和 #19 删除义务明确         |
| AUD14                | 原断言继续运行并带 todo 原因；不新增 skip-pattern 或定制统计                                                    |
| 文档与入口           | docs:check 通过，README 与 package.json 一致，旧 Python 命令已移除                                              |
| PR 故障验收          | 发布获准后，在临时验收 PR 引入一次类型错误或测试失败，保留真实红色检查记录；移除故障后验证绿色，故障不合入 main |
| main CI              | 获准合并后真实 workflow 成功，PG 实际执行且零 PG skip，再结项                                                   |

不另外编写原生 runner 的合成自测；故障传播通过 Issue #20 要求的真实 PR 红色检查验证。Master 已批准本地实施和测试；远端验收在真实 PR 检查与 main CI 完成前保持未完成。

## 6. 风险与回退

**预计 0.5–1 人日**，覆盖本地实现与隔离验证，不含远端评审等待。估算以当前有效测试没有额外业务缺陷为前提；归档迁移的引用和本地文档快照需按实际情况收尾。

主要不确定性是新纳入套件的真实首败。有效业务断言保持；若暴露超出测试适配范围的业务缺陷，向 Master 补充最小修复计划。issue4 的临时类型排除只用到 #19 删除该套件，AUD14 的字段问题交给 #24，不扩成长期豁免。

回退撤销本批测试入口、helper、workflow 和文档提交即可；不迁移业务数据。普通测试失败自动清理已创建的测试库，中断遗留库由专用手动命令处理。

## 7. 执行记录

- 2026-10-11：认领 Issue #20，完成静态核查与首版计划。
- 2026-10-11：按 Master 要求，工作及计划统一回 secretary-core/docs/fix，统一文档格式。
- 2026-10-11：读取远端 Claude 审查评论，核对 Node 官方文档及 Context/恢复源码；采纳 8 项建议。取消自定义 runner、固定 PG 计数、归档类型维护与逐文件散列；issue4 限于最小适配，增加 npm 缓存与受限手动清理。原计划中的“历史误报”改为 AUD14 待处理的字段语义问题。仅更新计划，尚未实施或运行测试。

- 2026-10-11：Master 批准在新分支实施、测试后汇报，审查后再合并。实施分支为 `codex/issue20-ci-implementation`，起点 `894200d`；仍在 secretary-core 主工作目录操作。

### 7.1 实现与范围

实现提交：`ebedbcaa878b028476a21ce8fa3568c9d44b98ff`。

- verify 使用原生 glob 与计数，顺序为 check、docs:check、测试。没有新增 runner 或 reporter。
- 全部当前 offline TypeScript 检查通过，包括 issue4，因此未使用临时类型排除。
- historical 整体迁到 test_case/historical/offline，源码原样保留，只更新归档说明与链接；不进入执行或类型检查。
- PostgreSQL 按场景分配空库，worker 使用场景 DSN。settings 的四个崩溃阶段原先在一个测试里循环，现注册成独立场景，各自有空库；原业务断言保持。
- helper 保持一条场景连接，覆盖 App.close 到重新打开的间隙，避免手动清理将进行中的恢复场景当作孤儿库。增加 helper 的并发隔离、失败清理、缺 DSN 行为回归。
- 删除三项退休 UI 合同及两个当前 Python PG 入口；保留 web-render 的全部纯 DOM 安全与大输入回归。AUD14 保留断言，标记 todo。
- 新增 GitHub Actions，固定 Actions 提交，启用 npm 缓存和 PostgreSQL 18 service。应用业务源码、API、DTO、SQL 和依赖锁未改动。
- 相对批准计划提交，代码（含测试/脚本，识别重命名后）新增 344 行、删除 407 行，净减 63 行；业务 src 净变化为 0。此口径不含 Markdown、JSON 和 YAML。

### 7.2 首轮基线与环境处置

环境为 Node 22.22.0、Python 3.9.6、PostgreSQL 18.6。npm ci 成功，现有及扩大范围后的类型检查均通过。

- 旧入口等价离线集合：422 项，405 通过、16 跳过、1 失败。失败为 activity 的真实 SIGKILL 用例等待 IN_FLIGHT 超时。初轮离线和 PG 基线同时运行；保留首败，未放宽等待条件或业务断言。之后单独运行完整 verify，该用例通过。
- 旧 PG 专项均通过。期间旧 PG 进程的绝对数据路径仍指向仓库改名前的位置，检查点报告 pg_control 路径不存在并退出。保存日志后，用当前目录和 socket 路径启动同一份 PG 数据目录；未更改数据库业务 schema 或持久配置，继续使用独立测试库。
- docs:check 初始 17 处断链全部来自一份未跟踪的旧隔离报告快照。将快照原样移入本机私密证据目录后检查通过；检查器未改动。
- 手动清理的独立验证首次因验证脚本 OWNER 语法、随后因本地 peer 认证失败；修正验证脚本并采用当前会话的临时角色后通过，未修改认证配置。首次失败记录保留。

### 7.3 验证结果

| 验证                                  | 结果                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 无 DSN 的完整 npm run verify          | 425 项：407 pass、0 fail、17 skip、1 todo；跳过均有 PG 缺 DSN 原因                               |
| CI=true + PG 18 的完整 npm run verify | 425 项：424 pass、0 fail、0 skip、1 todo；退出码 0，数据库测试全部实际执行                       |
| PG 接入专项                           | 43 pass、0 fail、0 skip，含 helper 并发隔离、回调失败清理和恢复测试                              |
| CI 缺 DSN、连接被拒绝、非法 DSN       | 三种场景均非零退出，未静默跳过，未输出合成口令                                                   |
| 手动孤儿库清理                        | 默认预览不删除；apply 只删除本角色空闲候选，保留连接库、忙碌库、其他角色库、非字面前缀库和普通库 |
| Workflow 静态检查                     | actionlint 1.7.12 通过                                                                           |
| 文档及差异检查                        | docs:check、git diff --check 通过                                                                |

完整 PostgreSQL verify 针对实现提交 `ebedbca` 运行，约 251 秒；无 DSN 的完整回归约 226 秒。最终测试库残留数量为 0。原始输出保存在本机私密证据目录；这里只记录合成结果与提交身份。

### 7.4 待 Master 审查及远端验收

本轮本地提交不合并 main。GitHub 上真实 PR 故障标红、恢复绿色和 main 首次 CI 尚未执行，Issue #20 保持 OPEN。Master 审查后继续办理发布及合并阶段的验收；main required check 配置另由 Master 决定。

- 2026-10-11：本地实施及上述验证完成，提交验收记录供 Master 审查。未推送、未合并、未关闭 Issue；真实 GitHub CI 验收保留为后续步骤。
