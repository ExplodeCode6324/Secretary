# 运行手册

所有命令均从仓库根目录执行。依赖 Node.js ≥22.19、npm 和 Python 3；World Model 测试使用 PostgreSQL 18。

```sh
git submodule update --init --recursive
npm ci --ignore-scripts
npm start
npm run start:web
```

默认 fixture 不调用真实模型；TUI 与 Web 连接同一数据目录后台。`/quit` 或 Ctrl+C 关闭客户端，后台继续运行。关闭默认 fixture 后台：

```sh
SECRETARY_DATA=.demo-data npm run stop
```

## 真实模型

本地 `.demo-data/live-credentials.json` 格式是 `{"main":"主会话密钥","task":"任务密钥"}`，使用真实值时只保存在本地并 `chmod 600`。不要把密钥放入聊天、任务材料或 Git。

```sh
npm run start:live
npm run start:web:live
npm run stop
```

start-live 脚本使用 opencode-go provider，默认 main 为 deepseek-v4.1-flash、task 为 gpt-5.6-luna；live 数据默认 `.demo-data/interactive-live`。这些是当前代码配置，不代表已重新核验服务商可用性。macOS 的启动与停止 `.command` 位于 `src/`，脚本自行切换到仓库根目录。

| 环境变量 | 行为 / 默认值 |
| --- | --- |
| SECRETARY_DATA | 数据目录；普通入口 `.demo-data`，live wrapper / stop `.demo-data/interactive-live` |
| SECRETARY_MODE | `live` 启用真实模型，其余走 fixture |
| SECRETARY_CREDENTIALS_FILE | live wrapper / 在线测试密钥文件；默认 `.demo-data/live-credentials.json` |
| SECRETARY_MAIN_MODEL / SECRETARY_TASK_MODEL | 两个角色独立模型 |
| SECRETARY_MAIN_PROVIDER / SECRETARY_TASK_PROVIDER | 直接入口的 provider；live wrapper 固定 opencode-go |
| SECRETARY_MAIN_API_KEY / SECRETARY_TASK_API_KEY | 直接 live 入口的角色密钥；wrapper 从本地文件注入 |
| SECRETARY_PROVIDER / SECRETARY_MODEL | 直接入口兼容的共享默认 provider/model；不共享角色密钥 |
| SECRETARY_DATABASE_URL | 可选 PostgreSQL DSN |
| SECRETARY_MAX_WORKERS | 默认 2 个任务执行者 |
| SECRETARY_MAX_OUTPUT_TOKENS | 普通模型回复上限默认 4096 |
| SECRETARY_COMPACTION_BYTES | 自动整理阈值，默认 32768 bytes |
| SECRETARY_COMPACTION_OUTPUT_TOKENS | 整理基础输出预算默认 8192 |
| SECRETARY_COLOR / NO_COLOR | 终端颜色设置 |

每个 loop 限制模型调用次数，传输设置 120 秒中断信号；这不是任意任务的完整端到端 SLA。

## World Model

配置专用数据库后执行：

```sh
SECRETARY_DATABASE_URL='postgresql://localhost/secretary' npm start -- --migrate
```

后台按版本读取 `src/schema/001_world_model.sql` 和 `002_predicates.sql`；不自动 drop 数据。运行中的后台不会因另开客户端修改环境变量，变更模型或 DSN 后应先正常停止相同数据目录的后台再启动。

## 排障与迁移

- OWNER_BUSY：该目录已有实例或独占检查正在运行，先确认现有后台。
- BACKEND_MODE_MISMATCH：同一目录混用了 fixture/live，使用匹配模式或另一数据目录。
- CORRUPT_OBJECT / journal 损坏：保留完整副本，核对备份与缺失原件，不能删除日志假装恢复。
- RESULT_UNKNOWN：查看操作和回执，文件写入可用 `/verify`；其他作用需要针对性核验，不直接重跑。
- 更换 checkout 路径后，旧 ProgramRegistration 的绝对 entrypoint 可能无效，重新登记新程序并复核相关任务。

目录整理已把旧 `demo_pi/.demo-data` 原样迁到根目录 `.demo-data`；未更改历史 journal / credential 内容。本次未自动重启 live 后台。自定义的外部绝对路径、外部快捷方式仍需指向新目录。新位置映射见 [整理说明](repository-layout.md)。

目录迁移也可能使历史 shell Operation 的绝对 cwd/resource 指向旧目录。历史记录保持原样；待执行操作需复核并重新提出适用的任务/授权，不能改写旧许可后继续执行。
