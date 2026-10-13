# 测试与验证

Issue #21/#28 联合验收包含 200 轮 Host、50 次累计覆盖、PG 故障/修复、Settings/重启、提取补试和固定 #21 合同回退边界。真实模型单独执行 [test-issue21-28-live.ts](../test_case/online/test-issue21-28-live.ts)，需要专用测试 DSN、已有凭据文件和私有证据目录；不以 fixture 或原文仍在请求中的回忆代替历史找回。该脚本最多 100 次发送、40 分钟总预算、单次 90 秒，保存实际 transport 和首轮失败。数据库由 withTestDatabase 创建并只清理本场景库。

## Issue #9 同步与通知验收

`npx tsx --test --test-concurrency=1 test_case/offline/issue9/*.test.ts` 覆盖持久位置/分叉、完整事务与字节退化、共同分页、最小客户端落盘/乱序、实际 SIGKILL、SSE/心跳/暂停 TCP/连接清理、瞬态预览、通知原子展示/幂等/Unicode、纯读与真实 PostgreSQL outbox。记忆来源和实际维护继续跑 issue3 commitment/provenance；原负例保持，新增展示证据负例纳入 issue9。高负载与崩溃用例串行运行。CI 必须提供专用 SECRETARY_TEST_DATABASE_URL（场景自动建独立库），World 不允许 skip。

编译期穷尽性单独验证：正常 check 通过后临时删除 mutationMappings 必需键，记录 check 因缺键失败，再原样恢复并 check 通过。反例不提交。完整入口仍为 npm run verify；types/docs/api 生成重复应零差异，Swift decode-examples.swift 单独验证。证据、首次失败和实现限制见 [API 验证记录](api/v1/verification.md)。

## 统一入口

Issue #21 的 `test_case/offline/issue21/` 验证实际 PG 中文/字面查询、联合过滤、完整分块及分片、投影水位、重建和 World 结构化提案。`test_case/performance/memory-search.ts` 单独执行 10 万合成事件基线，要求专用测试 DSN 与 `SECRETARY_MEMORY_SEARCH_EVIDENCE` 私有输出路径；结果单列高命中两字查询、自然计划与延迟。该脚本的 first query 是批量写入后的首次查询，OS 冷缓存结果需由隔离集群另行记录。

```sh
git submodule update --init --recursive
npm ci
npm run verify
```

需要 Node.js ≥22.19 和 Python 3。verify 顺序执行类型检查、文档链接检查、全部当前离线测试，任一阶段失败即返回非零。测试使用合成输入、临时 Store 和本地测试适配器。

`npm test` 自动发现 `test_case/offline/**/*.test.ts`；同目录的 TypeScript helper 也参与类型检查。定向入口有 `test:api`、`test:issue5`、`test:review`、`test:task-reuse`。历史探针另存于 [historical/offline](../test_case/historical/offline/README.md)。

## PostgreSQL 与 CI

```sh
SECRETARY_TEST_DATABASE_URL='<专用测试 DSN>' npm run verify
```

连接角色需要 CREATEDB。共享 testPostgres helper 为每个场景创建独立的 `secretary_test_` 数据库，场景的重启和 worker 复用该库，结束后清理。本地未配置 DSN 时相应测试明确 skip；CI 要求 DSN 可用并实际执行 PostgreSQL 场景。

[GitHub Actions](../.github/workflows/verify.yml) 在 PR 和 main push 上运行同一 verify，环境为 Ubuntu、Node 22、Python 3、固定 Pi 子模块和 PostgreSQL 18。模型凭据不参与 CI。

中断遗留的测试库可通过 `npm run test:db:clean` 列出；加 `-- --apply` 清理当前角色拥有、无活动连接且匹配前缀的候选库。

当前 AUD14 使用 Node 原生 TODO 保留断言：Context.tools_schema 的实际内容与工具定义语义待 #24 整理。测试汇总单列 TODO，仍执行其他断言。

## 覆盖重点

| 套件 | 主要覆盖 |
| --- | --- |
| runtime、audit | 调度、授权、工作目录、时间线、流式预览、Store 与模型适配 |
| issue2、issue3、issue5 | 容量、工作记忆、来源身份、承诺与设置后的历史投影 |
| issue8 | Core 生命周期、owner API、幂等、分页、公开 DTO 与产物读取 |
| issue10 | 操作文本有界续读、原回执保留、Scope 筛选、产物相对定位及 Swift 合同样例 |
| issue20 | 文档检查器和 PostgreSQL 测试数据库隔离/清理 |
| issue19 | 三次传输上限、维护退避、来源补提、成功响应/工具结果的崩溃恢复 |
| issue16 | Scope 管理、冻结绑定、DIRECTORY 串行、NONE 并行、归档和接续 |
| issue18 | 四种裁定、未知执行收束、wrapper 门控、进程身份与停止恢复 |

#16/#18 的进程用例实际启动子进程并覆盖 Core SIGKILL、wrapper 冻结、启动前取消和管道持有等窗口。macOS 本机验证进程行为，Linux CI 运行同组回归；启动标识变化与权限错误使用可控 fixture。

## 文档与合同

```sh
npm run docs:generate
npm run types:generate
npm run api:generate
npm run docs:check
npm run check
```

内部字段和 SQL 参考由运行 schema/SQL 生成；公开 OpenAPI 与 DTO 由 API schema/operations 生成。生成后检查 diff，重复生成应得到相同结果。API 测试覆盖独立消费者导入及合同；Swift 合成解码示例位于 docs/api/v1。

docs:check 检查 Git 跟踪 Markdown 的本地路径与迁移目标，新文件先纳入 Git。字段语义、章节锚点和说明与源码的一致性另行审阅。

## 真实模型与界面

显式 online 入口见 [online README](../test_case/online/README.md)，使用指定模型、已有凭据、新建隔离目录和请求/时间预算。记录实际 HTTP 次数、用量、首次失败及 oracle 结果。当前 API 产物场景核对 write/bash/read、同任务两轮、下载字节和独立程序计算；记忆场景覆盖真实整理及跨 OS 进程连续性。

历史 UI 探针和截图描述其原版本。当前 Core 使用 API v1，原生窗口、阅读位置和输入法已有本地回归；完整可访问性等联合验收仍归 #10 PR3c。已有真实模型结果统一收录在带日期的 [API 验证记录](api/v1/verification.md)。

每份运行报告注明提交、环境、命令、实际通过/失败/skip/TODO 和未运行项目。公开仓库保留脱敏结论，原始会话及凭据留在私密证据目录。

Issue #17 的 `test_case/offline/issue17/` 覆盖默认/显式授权、取消后继、remember 原子性与重启、只读命令正反例、Git argv 顺序及真实受控进程。历史审批回归显式使用 DIRECTORY + default_write=ask，继续断言未批准不写、路径替换拒绝和过期/版本冲突。

`test_case/online/test-issue17-live.ts` 是单独执行的真实模型验收，需私有凭据及 `SECRETARY_ISSUE17_EVIDENCE` 目录。它使用隔离合成项目，验证默认放行、ask 停等/批准继续、合成未知结果不重复写入；模型调用有次数和时间预算，不加入默认 npm test。原始日志和凭据不提交。

Issue #10 A0 的定向入口为 `npx tsx --test test_case/offline/issue10/*.test.ts`，覆盖大文本、Unicode、来源校验、游标隔离和 HTTP 认证。macOS 上使用 `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift docs/api/v1/decode-examples.swift docs/api/v1/examples.json` 验证公开样例；它仅证明 DTO 解码，不代表原生界面验收。

## PR3c 专项复现

先运行原生 verify 构建 UI target，再执行：

```sh
SECRETARY_MODE=fixture node --import tsx test_case/native/journey-fixture.ts
SECRETARY_RESOURCE_ACCEPTANCE=1 swift test --package-path src/secretary_macos/Packages/SecretaryKit --filter resourceAcceptance
```

连贯流程使用真实原生 GUI、公开 HTTP 和文件操作；模型输出与初始 Scope 为合成 fixture。需要已解锁、无遮挡的桌面；测试会使用系统默认应用打开自己的合成文本，再关闭该文档。失败保留私有临时目录。

资源测试默认使用小样本，`SECRETARY_RESOURCE_ACCEPTANCE=1` 才执行接近 1 GiB 的三次下载及 256 MiB 投影淘汰。`SECRETARY_RESOURCE_ROOT` 可指定下载测量目录；`SECRETARY_RESOURCE_THROTTLE_MS=1` 可延缓合成服务器以采样 URLSession 临时文件。缓存预算不代表整个文件系统峰值。

真实磁盘满测试默认跳过，只有 `SECRETARY_DISK_FULL_VOLUME` 指向专用可丢弃小卷时执行。测试拒绝容量超过 128 MiB 的文件系统；应创建独立 64 MiB APFS 磁盘映像并挂载，完成后卸载，不能指向工作盘或资料目录。测试写满独立卷，检查 SQLite 写入失败后原草稿与 pending request ID 在重开后保留。

`SECRETARY_MODE=fixture node --import tsx test_case/native/system-fixture.ts <全新私有目录>` 提供手动系统验收的合成 Core。只使用该目录的 endpoint，通过 `control.json` 写入 `{"action":"notice","label":"synthetic-test"}` 生成通知，每次使用不同 label；结束时向该进程发送 SIGTERM。它不自动改变权限、睡眠或用户设置。原始 endpoint、通知身份、日志和数据库不得提交。

## PR3b 原生替代与退役回归

逐项断言映射见 [迁移账表](fix/evidence/issue10-pr3b-migration-20261014.txt)。旧 TUI/Web 渲染测试中的领域断言迁入 `runtime/native-retirement.test.ts`、通知 API 测试及 SecretaryKit 的 `RetirementTests.swift`；服务器分页、UTF-8、会话隔离、容量与恢复断言保留。旧 browser/PTY 专属探针仅由固定历史提交追溯。

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
SECRETARY_TEST_DATABASE_URL='<专用测试 DSN>' src/secretary_macos/verify.sh
node test_case/native/ui-fixture.mjs
SECRETARY_MODE=fixture SECRETARY_TEST_DATABASE_URL='<专用测试 DSN>' node --import tsx test_case/native/management-fixture.ts --ui
```

GUI 必须在可用的本机图形会话运行；编译 UI target 不代表 GUI 通过。CI 分别运行 Core (Linux)、Native (macOS)，聚合 verify 要求两者成功。系统通知权限/点击、VoiceOver、真实睡眠、真实模型及接近 1 GiB 的资源实测归 PR3c，不用于替代本阶段的基本能力门槛。
