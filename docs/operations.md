# 运行手册

现行前端设计、组件、技术分工和验收统一从 [Current Frontend Spec](frontend/README.md) 进入。

从仓库根目录执行命令。需要 Node.js ≥22.19、npm、Python 3 和固定 Pi 子模块；World 与历史检索使用 PostgreSQL。

## 安装与启停

```sh
git submodule update --init --recursive
npm ci
npm start
npm run core -- status
npm run core -- attach
npm run stop
```

默认 fixture 模型、数据目录 `.demo-data`。`start` 启动后台 Core 或连接已有实例；`status`、`attach` 读取已有实例，无实例时退出 1，`stop` 无实例时退出 0。[core-cli](../src/pi_secretary/src/core-cli.ts) 只管理生命周期，业务操作使用 [CoreClient](../src/pi_secretary/src/core-client.ts) 或 [API v1](api/v1/README.md)。

`SECRETARY_DATA` 选择目录，管理命令使用相同目录和 `SECRETARY_MODE`。`core-endpoint.json` 保存地址、实例和本机 token，`core.log` 保存日志，两者权限为 0600。关闭客户端后后台 Core 继续运行。

## 真实模型与数据库

[start-live](../src/pi_secretary/scripts/start-live.ts) wrapper 从凭据 JSON 读取 main/task 两个密钥，固定使用 opencode-go provider：

```sh
npm run start:live
SECRETARY_MODE=live SECRETARY_DATA=.demo-data/interactive-live npm run core -- status
SECRETARY_MODE=live SECRETARY_DATA=.demo-data/interactive-live npm run stop
```

wrapper 默认凭据 `.demo-data/live-credentials.json`、数据 `.demo-data/interactive-live`，主模型 deepseek-v4.1-flash、任务模型 gpt-5.6-luna；角色模型环境变量可覆盖名称。直接 `SECRETARY_MODE=live npm start` 使用环境中的角色配置，可选择其他 provider。

| 环境变量 | 用途 |
| --- | --- |
| SECRETARY_DATA / SECRETARY_MODE | 数据目录与 fixture/live |
| SECRETARY_CREDENTIALS_FILE / SECRETARY_RUNTIME_FILE | wrapper 凭据文件 / 运行配置 |
| SECRETARY_MAIN_PROVIDER / SECRETARY_TASK_PROVIDER | 直接启动 Core 时的角色 provider |
| SECRETARY_MAIN_MODEL / SECRETARY_TASK_MODEL | 角色模型 |
| SECRETARY_MAIN_API_KEY / SECRETARY_TASK_API_KEY | 角色凭据 |
| SECRETARY_PROVIDER / SECRETARY_MODEL | 直接 Core 的共享默认值 |
| SECRETARY_DATABASE_URL | World 与检索 PostgreSQL DSN |
| SECRETARY_MAX_WORKERS | 并发执行者上限，默认 2 |

默认 live 目录读取可选 `.demo-data/live-runtime.json`，`database_url` 提供 DSN，环境 DSN 优先；未给环境 DSN 且配置 `local_postgres_data` 时，wrapper 用 pg_ctl 启动已有集群。配置数据库后通过 `admin/world/migrate` 初始化。Core stop 关闭连接，PostgreSQL 保持运行。预算参数见[记忆与提示词](memory-and-prompts.md#容量与配置)。

## 常用管理

所有 POST 带 UUID request_id；同一意图重试保持原 ID、路径和 body。202 回执可通过 `requests/{id}` 对账，关联资源提供业务进度。

| 工作 | API 路径，前缀 `/api/v1` |
| --- | --- |
| 对话与恢复 | POST messages、session/resume；GET timeline、requests/{id} |
| 工作范围 | GET/POST scopes；POST scopes/{id}、scopes/{id}/archive |
| 任务与决定 | POST task-requests、decisions/{id}/answer；GET tasks/{id}、executions/{id} |
| 审批与规则 | POST authorizations/{id}/decision；GET authorization-rules；POST admin/authorization-rules/{id}/disable |
| 设置 | GET settings；POST settings/draft、settings/apply、settings/applications/{id}/retry 或 restore-draft |
| 记忆 | POST session/compact、memory/extraction/retry、memory/commitments/{id}/resolve |
| 未知效果 | POST operations/{id}/verify-write 或 operations/{id}/resolve |
| 提醒与推送 | GET wakeups；POST wakeups/{id}/cancel；推送配置见[独立指南](api/v1/push.md) |
| 程序与数据库 | POST admin/programs、admin/world/migrate |

DIRECTORY 使用已存在的物理根，创建/更新时检查与其他活动根、Core 数据及仍占用旧根的冲突；NONE 只分组，任务各用独立目录。`default_write=ask` 关闭内建默认写入策略，有效用户规则继续参与匹配。归档 Scope 保留历史及已占槽执行，停止接收新工作。

以下示例在已有 Core 上登记仓库自带的合成程序：

```sh
SECRETARY_DATA=.demo-data node --import tsx --input-type=module <<'JS'
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { attachCore } from './src/pi_secretary/src/core-client.ts';
const client = await attachCore(path.resolve(process.env.SECRETARY_DATA));
if (!client) throw Error('Core 未运行');
console.log(await client.command('admin/programs', {
  request_id: randomUUID(), name: 'Synthetic report generator',
  entrypoint: path.resolve('src/pi_secretary/examples/report.mjs'),
}));
console.log(await client.query('admin/programs'));
JS
```

## 备份与升级

停止 Core，备份完整数据目录、配套 PostgreSQL、代码与配置。数据目录包含 journal.jsonl、objects/、workspaces/，DIRECTORY 任务的外部工作根另行备份。停机后可只读校验 CAS：

```sh
npx tsx src/pi_secretary/scripts/verify-cas.ts DATA_DIRECTORY
```

先在隔离副本验证新版本重放，再切换运行目录。未完成 Settings 使用原配置恢复；迁移目录时核对程序入口和 Execution 绑定。回退使用匹配版本的完整备份，并对账升级期间已经发生的外部作用。存储实现见[架构](architecture.md#数据与提交)。

## 故障排查

| 状态 | 处理 |
| --- | --- |
| OWNER_BUSY | 连接或停止该目录已有 Core |
| CORE_MODE_MISMATCH / UNSAFE_ENDPOINT | 核对目录、模式、发现文件归属与权限 |
| CAPACITY_BLOCKED / INPUT_EXIT_DISABLED | 查看 memory 状态、模型预算与 PostgreSQL 检索水位，恢复索引后重试维护 |
| RECOVERY_BLOCKED | 核对恢复错误中的 checkpoint、调用及工具回执，再通过 session/resume 处理 |
| RESULT_UNKNOWN | 核验文件写入或按实际证据裁定效果；确认受控进程停止后收束 |
| Settings BLOCKED | 使用原配置恢复，检查 World 批次回执并重试桥接 |
| RESYNC_REQUIRED | 重新取同步水位、加载资源，再追赶变更；原命令按 request_id 对账 |
| SECRET_UNAVAILABLE / 推送 FAILED | 检查目标私密配置或固定错误码，核对 dispatch 尝试记录 |
| journal/CAS 损坏或追加确认失败 | 保存完整副本，定位恢复错误；重新打开后以 journal 核对已提交结果 |

## 开发验证

```sh
npm run verify
SECRETARY_TEST_DATABASE_URL='<专用测试 DSN>' npm run verify
npm run docs:generate
npm run types:generate
npm run api:generate
```

verify 依次执行类型检查、Git 跟踪 Markdown 链接检查及 `test_case/offline/**/*.test.ts`。数据库角色需 CREATEDB；[测试 helper](../test_case/offline/helpers/postgres.ts) 为每场景建立 `secretary_test_` 独立库并清理，本地缺少 DSN 时明确 skip。`npm run test:db:clean` 列出遗留库，加 `-- --apply` 清理当前角色拥有、无活动连接且匹配前缀的候选。

[CI](../.github/workflows/verify.yml) 在 Linux 跑完整 verify 和 PostgreSQL 18，在 macOS 跑进程恢复、推送、Store 所有权与管道测试，聚合 verify 要求两者通过。新增文档先纳入 Git 再运行 docs:check；章节锚点和语义由审阅核对。生成命令执行后检查差异。真实模型测试与私有配置要求见 [online](../test_case/online/README.md)，历史结果见[验证记录](api/v1/verification.md)。

## 当前限制

- 当前入口为 Core CLI/API，SwiftUI 路线已废弃，客户端源码已移除，[历史实现](https://github.com/ExplodeCode6324/Secretary/blob/468a9c37939bb721792f353ea4970222a0bf58f2/src/secretary_macos/README.md)可从 Git 恢复。
- 手机真实送达归随身终端 #11，macOS 实际展示验收等待后续客户端安排。
