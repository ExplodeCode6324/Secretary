# Secretary_go_demo

基于 `BrainStorm_Baseline_v3.md`、`demo_design`、`state_machine` 和 `json` 契约独立编写的 Go 演示应用。BrainStorm 的职责和授权边界优先。主会话与任务 agent 的循环、记忆整理、调度、授权、存储和 HTTP 适配均为本项目代码；没有依赖或复制 Pi / OpenCode / Letta 的 agent 实现。

Master 的复核入口：[`REVIEW.md`](REVIEW.md)。实现选择与设计对应：[`ARCHITECTURE.md`](ARCHITECTURE.md)。

对比测试报告后的修复与新证据见 [`reports/improvements-20260922/README.md`](reports/improvements-20260922/README.md)。历史对比报告保留原样。

## 在当前 Mac 启动

双击 **`启动Secretary.command`**，在终端打开 TUI。它构建程序、启动专用 PostgreSQL（仅 Unix socket）和本地协调后台，再连接终端界面。建议终端至少 120 列 × 36 行。没有 WebUI，也不会打开浏览器。

退出 TUI 后任务与调度继续运行，再次双击入口即可重连。仅后台可用 `./scripts/start-background.sh` 启动；已有后台时可直接 `./bin/secretary tui`。

双击 **`停止Secretary.command`** 停止本 demo 后台；保留所有状态。在 TUI 中 Ctrl-C 打开退出确认，只退出界面。数据库可单独用 `./scripts/postgres.sh stop` 停止。

本次提供的两把 OpenCode Go 密钥已经分别写入本地 `.private/runtime.env`（0600，目录 0700，Git 忽略）。示例配置和代码不含密钥。真实测试使用 `gpt-5.6-luna` 和 `https://opencode.ai/zen/go/v1/responses`；主会话/整理调用使用主会话密钥，任务调用使用任务密钥。

首次使用可以输入：

> 请委派一个任务，在它自己的工作目录创建 hello.txt，内容为「Secretary Go 已启动」。验收标准是文件存在且内容正确，完成后汇报。

F3 审批页会显示具体文件、内容和执行身份。选择「批准这一次」并确认后才会写文件；普通聊天中的「同意」不会放行。完成后查看任务详情中的结果、产物引用和检查点。

## 终端操作

| 操作 | 按键 / 入口 |
| --- | --- |
| 主视图 | 左侧主会话与输入区，右侧 Task 看板，没有常驻导航栏 |
| 任务详情 | Ctrl+T 聚焦右侧看板，方向键选任务，Enter 打开详情，Esc 返回主视图 |
| 快捷切页 | F1 主会话、F2 任务、F3 审批、F4 记忆、F5 操作、F6 规则、F7 提醒、F8 日志 |
| 切焦点 | Tab / Shift+Tab；方向键选择、Enter 打开或执行按钮 |
| 多行输入 | Enter 换行，Ctrl+S 明确发送；粘贴不会自动发送 |
| 查看长内容 | Tab 聚焦详情后用方向键、PgUp/PgDn；确认页同样可滚动 |
| 任务管理 | 选计划后暂停/恢复/结束；选执行后读详情/请求取消；选普通决定后回答 |
| 授权 | 选审批记录后用底部按钮打开固定范围确认页；Tab 到「确认」后 Enter |
| 工作记忆 / 长期事实 | F4 查看、整理或检索；长期事实仍由 PostgreSQL 保存 |
| 请求状态未知 | Ctrl+R 重试同一请求编号和参数；期间不另发新命令 |
| 退出 | Ctrl-C 打开退出确认，Esc 返回；停止后台用停止入口 |

轮询保留输入草稿和按 ID 选中的记录。终端只展示最近 5000 条事件内的聊天/日志，完整原文仍在后台日志。未发送草稿仅在当前 TUI 内存中保留；退出确认会提示。提交状态未知时，先留在界面重试或检查后台记录。

## 从源码安装到另一目录

需要 Go 1.25+ 和 PostgreSQL。Go 依赖在 `go.mod/go.sum` 固定版本。

```sh
make build
cp configs/example.json configs/local.json
./bin/secretary init
export SECRETARY_MAIN_API_KEY='填写主会话密钥'
export SECRETARY_TASK_API_KEY='填写任务密钥'
export SECRETARY_PG_DSN='填写专用 PostgreSQL DSN'
./bin/secretary world migrate
./scripts/start.sh
```

也可使用 `.private/runtime.env`，但不要提交该文件。只有 World Model 使用 PostgreSQL；不配置 DSN 时界面明确显示不可用，其他模块可进行离线开发。数据目录和工作目录必须固定；不要在同一数据目录启动第二个协调进程。

## 实现内容

- 唯一主会话、持久 inbox、处理期间新输入排队、受限六工具、结构化工具结果及响应边界恢复。
- 独立任务 agent、人工登记程序、立即/指定时间/固定秒周期任务、前提检查、重叠排队或跳过、遗漏报告或单次补跑。
- 一次批准、拒绝、撤销、30 分钟到期、持续授权规则、最终 dispatch 检查和原子消费；主会话/任务 agent 都不能批准。
- 任务工作目录中的读取、列举和受控写入；程序采用固定 executable、空 argv、JSON stdin/stdout 协议。没有通用 shell 或任意网络工具。
- 原始 Operation Log、完整模型输入/输出、工具参数/结果、task context/checkpoint、不可变产物和程序 stdout/stderr。
- Consciousness 的 ACTIVE/QUIET/MINIMAL 事项、固定材料整理、版本 CAS、完整交互覆盖检查、未承接原文保留、容量阻塞。
- PostgreSQL 实体/来源/登记谓词/主张/证据、支持与分歧、修正与撤回、幂等回执及 outbox→journal 恢复。
- 任务详情刷新短期保留；待反馈/待工作不退休；退休只关闭短期入口，不删除历史。
- TUI 使用本地 Master token 连接 127.0.0.1 后台 API；没有网页、浏览器登录或 cookie 授权。持续规则是单独的人工作业入口。

## 人工登记程序

先停止应用，再运行：

```sh
./scripts/register-example.sh
```

它登记并启用 `programs/report.go` 编译的本地 JSON 报告程序。重新启动后，主会话通过 `task_query CAPABILITIES` 查到程序并可提出 PROGRAM 任务。每次启动仍需批准或明确匹配的持续规则。

自定义程序使用 `secretary program import <json>`，然后 `program enable <id>`；可 `disable <id>`。登记内容示例由上面的脚本生成在 `.local/program-example.json`。程序代码摘要变化会阻止执行，不自动授予新版本权限。程序不能被任意恢复到进程内部现场；本 demo 只支持完整启动，结果未知时停止核验。

## 验证

```sh
make test                 # 单元/集成、竞态、真实 SIGKILL 后恢复
make check                # go vet
python3 scripts/test-postgres.py  # 临时独立 PostgreSQL，无生产 DSN
```

真实模型验收为显式 opt-in，仅批准临时目录内预定的合成文件：

```sh
set -a; . ./.private/runtime.env; set +a
SECRETARY_LIVE_TEST=1 SECRETARY_LIVE_REPORT="$PWD/reports/live-model.json" \
  go test ./internal/engine -run TestLiveMainTaskAndConsciousness -v -count=1
```

`reports` 区分 `OFFLINE_RUNTIME`、PostgreSQL 集成和 `LIVE_MODEL`。这些结果不代替 Master 的 `REAL_USE` 复核，也不证明掉电恢复、任意程序的外部效果或摘要语义绝无遗漏。

短记忆题显式真实模型复测：导出私密环境后运行 `python3 scripts/verify-memory.py --attempts 3 --label 自选英文标识`。每次使用独立目录，拒绝覆盖已有报告；评分在控制器侧，答案不会送给模型。该检查不并入普通离线测试。
