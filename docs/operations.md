# 运行手册

当前入口是独立 Core API v1，命令从仓库根目录运行。需要 Node.js ≥22.19、npm、Python 3；World 可选，隔离数据库验证使用 PostgreSQL 18。此处描述代码行为，不表示已经部署现用实例。

## 安装与离线 Core

```sh
git submodule update --init --recursive
npm ci --ignore-scripts
npm start
npm run core -- status
npm run core -- attach
npm run stop
```

这些命令默认访问 `.demo-data`，默认 fixture 不调用真实模型。`start` 启动或附着独占 Core；`status` 和 `attach` 只连接既有实例，不启动新进程。无实例时输出 STOPPED，status/attach 退出 1、stop 退出 0。启动器退出后 Core 继续运行；停止必须显式执行。

自定义目录时，各条命令使用同一 `SECRETARY_DATA` 和匹配的 `SECRETARY_MODE`。发现文件为该目录的 `core-endpoint.json`，日志为 `core.log`；endpoint 含秘密 token，不应公开。CLI 只打印 Core 状态或回执，不打印 token。完整鉴权、响应与错误语义见 [API v1](api/v1/README.md)。

`npm run start:web` 返回旧界面退役错误；`npm run start:web:live` 拒绝 `--web`。旧 TUI/Web 的双击启动器和 `src/停止Secretary后台.command` 仍依赖旧入口/旧发现文件，不适用于新版 Core。当前没有可用 SwiftUI 或新版 TUI，不能用这些遗留脚本完成新版界面验收。

## 真实模型 Core

启动 wrapper 读取现有私密凭据文件，JSON 包含独立 `main`、`task` 两项；文件应限制为本机用户读取，不放入 Git、任务材料或公开日志。

```sh
npm run start:live
# wrapper 默认数据目录与模式不同于普通 npm start；管理时必须明确匹配。
SECRETARY_MODE=live SECRETARY_DATA=.demo-data/interactive-live npm run core -- status
SECRETARY_MODE=live SECRETARY_DATA=.demo-data/interactive-live npm run stop
```

`start-live.ts` 固定两个角色的 provider 为 opencode-go，默认 main=deepseek-v4.1-flash、task=gpt-5.6-luna；模型可由角色环境变量覆盖。这是源码默认值，不是服务商可用性或价格保证。wrapper 默认数据目录为 `.demo-data/interactive-live`，凭据路径为 `.demo-data/live-credentials.json`。

默认 live 目录会读取可选 `.demo-data/live-runtime.json`，或显式 `SECRETARY_RUNTIME_FILE`。自定义数据目录不自动继承默认 runtime 文件。runtime 的 `database_url` 提供 DSN；环境 `SECRETARY_DATABASE_URL` 优先。未提供环境 DSN 且配置 `local_postgres_data` 时，wrapper 可用 `pg_ctl` 启动该既有集群；不会建库或自动迁移。Core 停止会关闭自身数据库连接，不会停止 PostgreSQL 服务。生产数据库启停与备份按实际部署单独处理。

直接 `SECRETARY_MODE=live npm start` 不读取 wrapper 的凭据 JSON；须由环境提供角色 provider/model/API key。不要将密钥写入命令历史或文档示例。

| 配置 | 当前代码行为 |
| --- | --- |
| SECRETARY_DATA | CLI/start/stop 默认 `.demo-data`；live wrapper 默认 `.demo-data/interactive-live` |
| SECRETARY_MODE | `live` 使用 provider，其他值走 fixture；附着须与运行实例匹配 |
| SECRETARY_CREDENTIALS_FILE | live wrapper 读取已有 main/task 凭据 |
| SECRETARY_MAIN_PROVIDER / SECRETARY_TASK_PROVIDER | 直接 Core 的角色 provider；wrapper 固定 opencode-go |
| SECRETARY_MAIN_MODEL / SECRETARY_TASK_MODEL | 角色模型；wrapper 有上述默认值 |
| SECRETARY_MAIN_API_KEY / SECRETARY_TASK_API_KEY | 直接 Core 使用角色密钥；wrapper 从凭据文件注入 |
| SECRETARY_PROVIDER / SECRETARY_MODEL | 直接入口的共享 provider/model fallback，不共享角色密钥 |
| SECRETARY_DATABASE_URL | 可选 World DSN；已配置不等于数据库可用/已迁移 |
| SECRETARY_MAX_WORKERS | 默认 2 个任务执行者 |
| SECRETARY_MAX_OUTPUT_TOKENS | 普通调用输出目标 4096 |
| SECRETARY_COMPACTION_OUTPUT_TOKENS / SECRETARY_COMPACTION_RETRY_OUTPUT_TOKENS | 摘要目标 16384 / 32768，受模型及部署上限约束 |
| SECRETARY_MAIN_* / SECRETARY_TASK_* 容量上限 | CONTEXT_WINDOW、INPUT_TOKENS、OUTPUT_TOKENS；完整参数见[容量规范](memory-and-prompts.md#容量与配置) |
| SECRETARY_MEMORY_UPDATE_TURNS / SECRETARY_MEMORY_UPDATE_SECONDS / SECRETARY_MEMORY_MIN_INTERVAL_SECONDS | 记忆维护默认 8 个完成轮次 / 60 秒 / 120 秒最小间隔 |

旧 SECRETARY_COMPACTION_BYTES 不再触发自动维护。旧终端颜色参数不属于 Core API 配置。模型传输的默认 120 秒中断信号不是任务端到端 SLA；online harness 另有更严格预算。

## 通过 API 操作与对账

使用 [CoreClient](../src/pi_secretary/src/core-client.ts) 或实现同等合同的本机调用方。命令必须有新 UUID request_id；重试同一意图保留原路径、ID 和完整 body，先用 `GET /api/v1/requests/{id}` 对账。202 仅为持久受理；任务看 Execution/Operation，设置看 SettingsApplication，不把 ACCEPTED 当成业务成功。

| 操作 | 新版入口（均以 `/api/v1` 为前缀） |
| --- | --- |
| 输入和时间线 | POST `/messages`；GET `/timeline`、`/timeline/around`、`/messages/{id}/content` |
| 提交/续接任务 | POST `/task-requests`；GET `/tasks/{id}`、`/executions/{id}` |
| 批准副作用 | GET `/authorizations/{id}` 完整展示；POST `/authorizations/{id}/decision` 带 revision 和 display_hash |
| 工作决定 | POST `/decisions/{id}/answer`，与审批分离 |
| 显式访问执行 | POST `/executions/{id}/viewed`；GET 不续留 |
| 设置草稿/应用 | GET `/settings`；POST `/settings/draft`、`/settings/apply` |
| 记忆维护/承诺 | POST `/session/compact`、`/memory/commitments/{id}/resolve` |
| 提取恢复 | GET `/memory/recovery`；POST `/memory/recovery` 带完整 binding |
| 未知文件写入核验 | POST `/operations/{id}/verify-write`；shell 无通用自动核验 |
| World 迁移 | POST `/admin/world/migrate`，随后按请求回执与领域结果确认 |

CLI 只支持 start/attach/status/stop；`npm start -- --migrate` 不执行数据库迁移，旧 `/compact`、`/verify` 等终端文本也不是 Core 命令。World 迁移读取现行 SQL 版本，不 drop 数据。草稿/应用/重试的字段以[操作表](api/v1/operations.json)和[设置规范](settings-activation.md)为准。

只读预检签发的恢复 binding 有效期 5 分钟且绑定当前服务实例。过期或重启后未消费票据应重新预检；已消费请求仍沿用原 ID 对账。BLOCKED、UNKNOWN、设置重试和换 ID 都不授权盲目重发模型或外部动作。

## 观察与故障处理

时间线可显式请求 `streaming=true`、`thinking=true`，仅显示供应商提供的可见内容。预览只在内存中，不是可靠 SSE；新版没有旧 `/api/state`、`/api/stream`、`/api/poll`。客户端缓存、阅读位置、字体和显示开关仍由未来客户端实现。当前 API 无通知 presented/已读命令，普通读取不会生成 SENT 回执。

- OWNER_BUSY：先确认同一目录的 writer，不并行打开另一个 App 或删除锁。
- CORE_MODE_MISMATCH / UNSAFE_ENDPOINT：核对目录、模式、发现文件 owner/权限，不能以旧 ui-endpoint.json 替代。
- CAPACITY_BLOCKED / RECOVERY_BLOCKED：保留原件和错误，按模型预算、来源证据及恢复入口对账。
- journal/CAS 损坏：保留完整副本，不能删日志或创建空会话伪装恢复。
- RESULT_UNKNOWN / ApiCommand UNKNOWN：核对领域回执；取消或换 request_id 不证明未发生作用。
- Settings BLOCKED：先确认原数据库、配置与批次回执，不清空本地记录绕过 gate。

## 升级与回退

停止旧 writer，备份完整数据目录及对应 PostgreSQL、代码与配置并记录校验。先在隔离副本验证回放；新旧版本不能同时写同一数据域。未完成 Settings 要用其原配置恢复，不能直接换模型/DSN。

新版会生成旧版本不认识的持久记录，不支持旧 TUI/Web 协议。回退须使用经核验的旧代码、配置和匹配的数据备份，先对账升级后外部作用，禁止用旧备份重复执行。旧 ProgramRegistration 的绝对入口和 shell cwd/resource 在迁移后可能失效，不能修改历史许可来掩盖变化。详见[持久化](persistence.md)和[API 切换说明](api/v1/README.md#切换与回退)。
