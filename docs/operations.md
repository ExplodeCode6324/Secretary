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

.demo-data/interactive-live 默认会话的 live 启动器读取可选的本地 `.demo-data/live-runtime.json`（可用 `SECRETARY_RUNTIME_FILE` 指定）。自定义 `SECRETARY_DATA` 不自动继承默认会话的数据库配置，需显式指定运行配置或 DSN。`database_url` 提供 World DSN；显式 `SECRETARY_DATABASE_URL` 优先。若未指定环境 DSN 且配置含 `local_postgres_data`，启动器通过 PATH 中的 `pg_ctl` 检查并启动该既有集群，不自动建库或迁移。此配置不提交 Git，也不包含模型密钥。2026-09-28 的本机部署使用 `.demo-data/world-postgres` 与私有 `.demo-data/pg-socket`，禁用 PostgreSQL TCP 监听。正常关闭 Secretary 后台不关闭数据库；需要全部停机时再执行 `pg_ctl -D .demo-data/world-postgres -m fast -w stop`，后续 live 启动器会重新启动它。

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
| SECRETARY_COMPACTION_OUTPUT_TOKENS | 普通单来源整理的基础输出预算默认 8192；设置完整整理使用 8192/16384 两次尝试预算，均受模型 maxTokens 限制 |
| SECRETARY_COLOR / NO_COLOR | 终端颜色设置 |

每个 loop 限制模型调用次数，传输设置 120 秒中断信号；这不是任意任务的完整端到端 SLA。

## 流式输出与思考显示

WebUI 主会话顶部「显示设置」提供两个独立开关，初次打开均为开启：

| 流式输出 | 显示思考过程 | 展示行为 |
| --- | --- | --- |
| 开 | 开 | 正文和可见思考内容逐段出现 |
| 开 | 关 | 仅正文逐段出现 |
| 关 | 开 | 当前模型响应完成后展示正文及思考内容 |
| 关 | 关 | 当前模型响应完成后只展示正文 |

偏好保存于当前浏览器的站点存储，刷新后保留；更换浏览器或站点端口可能使用默认值。运行中也可切换，关闭思考会立即隐藏并清理页面中的思考文本，重新开启可读取已保存内容。这些显示偏好即时生效，不需要「应用全部更改并重建上下文」，不改变模型推理强度，也不表示关闭模型内部推理。

思考区在对应回复正文之前，采用 12px 字体（正文默认 14px）及现有暗色配色，可点击标题折叠。它仅展示供应商返回的可见思考文本或摘要；未返回时显示说明，不补写或推测内部过程。Task Agent、记忆整理和设置重建的内部内容不进入主会话思考区。TUI 仍保持完成后展示正文。

实时连接中断后自动重连，恢复当前预览；页面关闭不终止后台任务，不重新发送模型请求。未完成输出显示「未完成」。预览长度有界，截断时有提示，最终正文以已保存响应为准。后台重启会丢失临时预览，但已保存的正文与可见思考可恢复；后台端口和 token 可能变化，重启后用 `npm run start:web:live`（fixture 用 `npm run start:web`）重新打开页面。

升级后端代码须在会话和任务空闲时正常重启后台，再重新打开 WebUI。仅更新静态页面时刷新即可。若暂不需要增量显示，关闭「流式输出」即可恢复完成后展示。

## World Model

配置专用数据库后执行：

```sh
SECRETARY_DATABASE_URL='postgresql://localhost/secretary' npm start -- --migrate
```

后台按版本读取 `src/schema/001_world_model.sql` 、`002_predicates.sql` 和 `003_settings.sql`；不自动 drop 数据。运行中的后台不会因另开客户端修改环境变量，变更模型或 DSN 前先恢复未完成轮次和设置应用，再正常停止相同数据目录的后台；新配置启动后自动摘要并重建 context，成功前不领取新输入。

## 排障与迁移

- OWNER_BUSY：该目录已有实例或独占检查正在运行，先确认现有后台。
- BACKEND_MODE_MISMATCH：同一目录混用了 fixture/live，使用匹配模式或另一数据目录。
- CORRUPT_OBJECT / journal 损坏：保留完整副本，核对备份与缺失原件，不能删除日志假装恢复。
- RESULT_UNKNOWN：查看操作和回执，文件写入可用 `/verify`；其他作用需要针对性核验，不直接重跑。
- 更换 checkout 路径后，旧 ProgramRegistration 的绝对 entrypoint 可能无效，重新登记新程序并复核相关任务。

目录整理已把旧 `demo_pi/.demo-data` 原样迁到根目录 `.demo-data`；未更改历史 journal / credential 内容。本次未自动重启 live 后台。自定义的外部绝对路径、外部快捷方式仍需指向新目录。新位置映射见 [整理说明](repository-layout.md)。

目录迁移也可能使历史 shell Operation 的绝对 cwd/resource 指向旧目录。历史记录保持原样；待执行操作需复核并重新提出适用的任务/授权，不能改写旧许可后继续执行。

## 管理 World Model 与应用设置

在 WebUI 打开「World Model 管理」，创建或修改实体、登记/更正/撤回事实，保存草稿后点击「应用全部更改并重建上下文」。Secretary 说明使用同一草稿和应用批次。等待显示已生效；失败可重试，版本冲突应刷新数据并修正草稿。BLOCKED 时查看错误并恢复原数据库/模型连接，不能删除 journal 或重新创建会话规避。当前历史没有物理删除入口。

已有数据库须显式运行迁移以增加版本 3 批次回执表。升级前正常停机，并同时备份完整数据目录与 PostgreSQL；新代码生成的新记录不保证旧二进制可读。完整步骤、容量限制和恢复边界见[设置生效规范](settings-activation.md)。这份实现交付不自动迁移或重启现用服务。

## 任务接续与升级

已结束任务的修改由主会话查询原任务后提交接续；只解释结果无需新增执行。新轮次使用同一 work 目录，但旧产物可从原 TaskResult 对象读取。尚未分派的接续可通过 task_control 的 cancel_request 取消，request_id 在任务查询的 latest_request 中；已经分派则进入原执行取消流程。

本次新增持久字段支持读取旧数据，不支持将新 journal 直接交给旧版代码。部署前在完整隔离副本验证升级，备份代码及完整数据目录，并复核活跃/未知执行；部署和现用数据迁移应单独安排。出现问题时停止新派发并保留回执，按[恢复规则](persistence.md)使用兼容版本恢复，不能回滚历史后重复外部操作。
