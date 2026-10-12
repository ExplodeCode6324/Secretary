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

历史 UI 探针和截图描述其原版本。当前 Core 使用 API v1，原生窗口、阅读位置、输入法与可访问性将随 #10 验收。已有真实模型结果统一收录在带日期的 [API 验证记录](api/v1/verification.md)。

每份运行报告注明提交、环境、命令、实际通过/失败/skip/TODO 和未运行项目。公开仓库保留脱敏结论，原始会话及凭据留在私密证据目录。

Issue #17 的 `test_case/offline/issue17/` 覆盖默认/显式授权、取消后继、remember 原子性与重启、只读命令正反例、Git argv 顺序及真实受控进程。历史审批回归显式使用 DIRECTORY + default_write=ask，继续断言未批准不写、路径替换拒绝和过期/版本冲突。

`test_case/online/test-issue17-live.ts` 是单独执行的真实模型验收，需私有凭据及 `SECRETARY_ISSUE17_EVIDENCE` 目录。它使用隔离合成项目，验证默认放行、ask 停等/批准继续、合成未知结果不重复写入；模型调用有次数和时间预算，不加入默认 npm test。原始日志和凭据不提交。
