# 测试与验证

## 统一入口

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
