> 历史归档：设计阶段的原始设计或早期实现说明，和当前代码不构成证据对应。命令、路径与结论仅供历史追溯；当前入口见 [项目文档](../../README.md)。

# pi_secretary

Secretary 的可运行验证原型。模型循环直接从 `../pi_resource/packages/agent/src/agent.ts` 导入；执行端的 read/write 和 Node 文件后端也复用 Pi 源码。Secretary 自己实现输入队列、可靠提交、调度、统一授权和资料交接。

完整功能入口与验证范围见 [TUI_FEATURES.md](TUI_FEATURES.md)。

## 启动与复核

在 `demo_pi` 目录运行 `npm start`，直接进入终端 TUI。默认运行数据保存在 `.demo-data`，已排除出 Git。`npm run start:live` 同样进入 TUI，并使用已配置的两组模型凭据。TUI 与 WebUI 共用一个本机后台，后台独占数据目录，只监听 127.0.0.1。WebUI 用 `npm run start:web`，真实模型用 `npm run start:web:live`。双开步骤见 [UI_DUAL_REVIEW.md](../../../test_case/reports/implementation/UI_DUAL_REVIEW.md)。

直接输入文字向主会话发消息；`/help` 查看命令。启动菜单明确显示授权和工作决定入口，`/menu` 可随时返回。终端支持历史、方向键编辑、滚动回看；后台反馈到达时保留正在编辑的输入。

| 操作 | 命令 |
|---|---|
| 会话状态与模型 | `/status` |
| 任务列表与详情 | `/tasks`、`/show <execution-id>` |
| 直接创建 Agent / 程序任务 | `/task <目标>`、`/program <program-id> <目标>` |
| 查看待授权及完整请求 | `/auth`、`/approvals`、`/approval A1` |
| 批准、拒绝、撤销已读请求 | `/approve <id>`、`/reject <id>`、`/revoke <id>` |
| 工作决定 | `/decisions`、`/answer <id> <回答>` |
| 取消与未知写入核验 | `/cancel <execution-id>`、`/verify <operation-id>` |
| 整理与中断恢复 | `/compact`、`/resume` |
| 关闭当前终端（后台继续运行） | `/quit` 或 Ctrl+C |
| 打开同一主会话的网页 | `/web` |

新授权会自动展开完整卡片，显示任务、动作、资源、参数及 `/approve A1`、`/reject A1`。也可用 `/auth` 随时查看。只有完整请求展示过后才能批准；请求版本变化后需要查看更新的卡片。A1 / D1 / P1 / E1 是本次终端会话内稳定的短编号，重启后需按新卡片操作。工作决定直接显示 `/answer D1 <回答>`，回答记录保留 MASTER 来源。聊天中的“同意”不产生授权，模型输出中的命令也只作为文本显示。主会话处理期间仍可操作任务与授权。

离线验证可以输入 `task: 整理一份测试报告`。退出再启动可恢复原会话、任务和日志；未知作用不会因重启而重复执行。

高级入口：`/programs` 查看可选程序，`/task-json <JSON>` 提交定时、周期、材料和约束；`/operations` 查看未知操作，`/rules` 查看规则，`/history` 回看最近会话，`/world-read <subject-id>` 查询指定实体。

## 人工程序登记

在正在运行的 TUI 中输入 `/register-example` 登记示例程序。复制返回的 program ID，用 `/program <id> 生成一份测试报告` 创建任务，再通过授权命令批准执行。

自定义登记用 `/register {"entrypoint":"程序绝对路径","name":"名称"}`；授权规则用 `/rule {"action":"动作","resource":"资源","parameters":{}}`。`/world` 查询 World Model，`/world <JSON>` 提交变更提案。模型没有这些 Master 终端命令的执行权限。

程序协议为 stdin 接收 JSON，stdout 输出符合登记结果 schema 的 JSON，stderr 保存过程记录。示例程序将文件写入该 task 的 workspace。

本原型的程序后端运行人工登记的 Node 脚本，启动时核对登记版本与入口文件 SHA-256。授权界面展示版本、代码摘要、参数及整体执行范围；内部动作以该程序的整体执行为授权单位。`supports_resume=false`，不把程序日志当作任意现场的恢复能力。

## 真实模型模式

OpenCode Go 已完成 DeepSeek V4.1 Flash 与 GPT 5.6 Luna 的真实链路测试，结果与失败修复记录见 [LIVE_REVIEW.md](../../../test_case/reports/implementation/LIVE_REVIEW.md)。

本地保存两把角色密钥的文件为 `demo_pi/.demo-data/live-credentials.json`，字段是 `main` / `task`，文件权限为 0600，整个目录排除出 Git。已有本地配置时，在 `demo_pi` 运行：

```sh
npm run start:live
```

默认主会话使用 `deepseek-v4.1-flash`，任务 agent 使用 `gpt-5.6-luna`，运行资料独立保存在 `.demo-data/interactive-live`。这条命令会调用真实 API。主会话与任务 agent 分别读取自己的密钥；主会话的 Consciousness 维护沿用主会话配置。不要将密钥作为消息、任务材料或命令行参数传入。

可用 `SECRETARY_MAIN_MODEL` / `SECRETARY_TASK_MODEL` 修改模型；`SECRETARY_CREDENTIALS_FILE` 修改本地密钥文件位置。直接运行 `npm start` 时也可用 `SECRETARY_MODE=live`、`SECRETARY_MAIN_PROVIDER` / `SECRETARY_TASK_PROVIDER`、`SECRETARY_MAIN_MODEL` / `SECRETARY_TASK_MODEL`、`SECRETARY_MAIN_API_KEY` / `SECRETARY_TASK_API_KEY` 配置。兼容旧的 `SECRETARY_PROVIDER` / `SECRETARY_MODEL` 作为两个角色的模型默认值，但角色密钥必须独立明确提供。

OpenCode Go 的 Pi 配置固定使用 `https://opencode.ai/zen/go/v1`：DeepSeek 走 chat/completions，Luna 走 responses。每个主会话/执行实例有稳定会话 header，使用本客户端 User-Agent；关闭 SDK 自动重试。具体路由以固定 Pi 模型目录为准。

不同任务默认最多 2 个执行者，可通过 `SECRETARY_MAX_WORKERS` 调整。每个 loop 最多 20 次模型调用，单次传输设置 120 秒中断信号。主会话只注册 MemoryUtil/TaskControl/MasterInteract 对应的六个工具。执行 agent 注册 Pi read/write、普通工作决定和结构化结果提交工具；写入经过 Scheduler 最终授权检查。没有直接给主会话注册 Pi bash 或任意扩展加载入口。

默认上下文容量取模型元数据，预留 4096 tokens；字节估算用于预先阻塞，最终 token 消耗仍由 provider 决定。`SECRETARY_COMPACTION_BYTES` 控制宿主自动安排整理的原文长度阈值，默认 32768 bytes。保留未承接原文；整理模型输出按事项形成工作记忆。离线 fixture 不证明摘要质量或压缩效果。

## World Model

设置 `SECRETARY_DATABASE_URL` 指向**为这个 demo 专门准备的数据库**，首次运行：

```sh
npm start -- --migrate
```

该开关通过共享后台按迁移版本应用项目 `schema/001_world_model.sql` 和 `002_predicates.sql`。不修改别的 schema，不自动清空数据库。不要将原型接到有业务数据的数据库。

World Model 未配置时，对应工具明确返回 UNAVAILABLE；其他模块仍可独立运行。实体/来源登记、事实新增/更正/撤回、冲突投影、版本 CAS、提交回执和 outbox 都由 PostgreSQL 后端执行。所需授权通过同一 Scheduler，PostgreSQL 不保存授权规则。

## 数据与恢复

`Store` 对所有持久化记录执行项目 JSON Schema 校验，单个 JSONL 帧包含跨对象变更与日志。对象先落盘并同步，再同步 journal 后确认接收。系统文件锁由小型 Python fcntl helper 持有，进程管道关闭后由 OS 释放，不以 PID 文件冒充互斥。

Context 原始字节、工具输入输出、程序 stdout/stderr 和结果对象按内容摘要保存。`workspaces/<task_id>` 的工作文件可变，证据/Context 对象不可变。复载校验 hash；原件缺失或日志中段损坏会阻塞恢复。

详情查询刷新短期留存，列表查询不刷新；候选 48 小时只作用于已终结、没有待处理工作的执行。退出后仍保留历史对象。当前未实现历史 GC、日志分段和快照加速，因此日志会随使用增长。

## 验证

```sh
npm run check
npm test
python3 pi_secretary/scripts/test-postgres.py --pg-bin /path/to/postgresql/bin
```

普通测试不调用真实模型。PostgreSQL 测试脚本自己创建临时集群，执行真实 TypeScript 仓储，再停止并清理；不连接应用数据库。具体结果和运行边界见 [REVIEW.md](../../../test_case/reports/implementation/REVIEW.md)；真实模型测试需显式运行 `npm run test:live -- <model> <scenario> [task-model]`，不会包含在 `npm test` 中。scenario 为 chain / missing / unknown / transport / reject。测试驾驶器只代行批准指定 result.mjs 的写入，模拟故障有明确标记，原始运行资料留在本地。

### 真实 shell 任务（2026-09-22）

任务 agent 现有 `read`、`write`、`bash`、`request_decision` 和 `submit_result`。
`bash` 支持本机真实命令执行、文件操作和网络访问，以当前用户运行，默认工作目录为任务的 `work` 目录；这不是操作系统沙箱。每次 shell 操作沿用授权卡和 `/approve`，批准后由 Scheduler 执行并将 stdout、stderr、exit_code 保存为操作回执，交给恢复后的 agent。模型 API 密钥不通过子进程环境变量继承。

默认超时 120 秒，可用 `timeout` 指定 0.1–3600 秒；stdout/stderr 各限制为 4 MiB。超时、取消或输出超限会终止进程组并标记 `RESULT_UNKNOWN`，不自动重跑已有副作用。正常退出的操作表示命令调用完成，非零 exit_code 仍是命令失败证据，不能据此宣称任务成功。用 `/cancel <execution-id>` 停止任务。

修改后退出旧测试进程，再双击 demo_pi 下的 `启动Secretary_Pi.command` 加载新工具。

### 工作记忆维护 v2（2026-09-22）

Consciousness 的 `commitments` 是宿主管理的承诺记录：稳定 ID、原文、OPEN/COMPLETED/CANCELLED、来源和处理凭证。旧承诺保留原文迁移，摘要改写或遗漏不能删除承诺。仅有匹配任务结果、承诺来源之后的 SENT 通知时，狭义的结果汇报承诺可自动完成；一般或复合承诺继续保留，由 Master 用 `/memory-resolve <完整承诺ID> <COMPLETED|CANCELLED> <说明>` 明确处理。此命令不注册为模型工具。

整理读取已有事项、新增事件以及宿主任务状态；原始用户输入完整保留，工具长输出使用带原文引用的摘录。历史生成的工作记忆头不会作为用户原始输入反复累积。`covered_event_sequence` 标识覆盖边界，版本变化或期间有新输入则旧候选记为 STALE。

`SECRETARY_COMPACTION_OUTPUT_TOKENS` 默认 8192，与普通回复的 4096 上限分开。最多两次尝试，第二次缩短工具摘录、提高输出预算（受模型上限限制）；遇到 length 明确报告 SUMMARY_OUTPUT_TRUNCATED。两次失败后保留旧摘要和全部原文，停止对同一来源自动重试；`/compact` 可手动再试。

`/memory` 显示最近成功时间、失败原因、尝试次数和承诺列表；TUI 状态及 WebUI 记忆标记也显示整理状态。Context 记录可信的实际记忆版本、本轮输入 ID、未完成工具调用，并区分 CHECKPOINT 与 MODEL_REQUEST。日志增加 consciousness.started/retry/attempt_failed/failed/stale/committed/master_resolved 事件。

维护验证脚本 `pi_secretary/scripts/verify-memory-live.ts <数据目录> <报告路径>` 会获取数据目录独占锁，只执行记忆整理和无工具的真实模型只读探针；不启动调度循环、不新增用户输入、不执行或批准任务。运行中实例应先正常停后台，优先对完整副本验证。报告仍须人工评估语义正确性，不能将结构或哈希检查当作记忆内容已被独立证明。

### Secretary 说明（用户自定义提示词）

Web 左侧「Secretary 说明」提供独立的用户说明编辑框，最多 2000 个 Unicode 字符。
初始说明默认简体中文、称呼 Master、简洁回答；清空正文即关闭自定义部分。
保存立即持久化，从下一轮主会话开始生效；当前轮与崩溃恢复继续使用开始时的版本。

说明以 `UserInstructions` 单例保存在现有 journal 中，不依赖 PostgreSQL，不由模型或记忆整理改写。
`MainPromptSnapshot` 与输入领取在同一事务中提交，记录本轮的完整 system 消息及工具声明；Context 记录
`base_prompt_version`、`instructions_revision`、`system_prompt_hash`。历史 Context 不被覆盖。
新轮显式替换历史 system 消息；旧版中断轮首次恢复仍保留原 system，下一轮才采用新配置。

设置页会显示当前轮、最近使用及下轮版本。并发保存采用版本校验：发生冲突时保留草稿，点「重新载入」读取服务器版本后再编辑。
普通同文重复保存不增加版本；超长或含控制字符的内容拒绝保存。没有模型工具可修改此设置。
任务 agent 与记忆整理仍使用各自的专用提示词。说明注入属于提示词机制，不是模型语言输出的硬约束。

验证：`npm run verify`；真实模型隔离测试（会产生 API 用量）：
`node --import tsx pi_secretary/scripts/test-instructions-live.ts`。
本次复核结果见 [说明功能复核](../../../test_case/reports/pi/instructions-20260923/REVIEW.md)。
