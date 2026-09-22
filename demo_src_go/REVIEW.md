# Master 复核入口

Secretary_go_demo 已可构建、启动和运行，源码位于本目录。BrainStorm 基线未修改；具体收敛和已知边界见 [ARCHITECTURE.md](ARCHITECTURE.md)。

针对独立对比报告的最新修复与回归入口：[improvements-20260922](reports/improvements-20260922/README.md)。原报告中未跑完的 120 条整体验收、长期运行及快照恢复项目，不能用本次局部回归替代。

## 建议复核顺序

1. 双击 `启动Secretary.command`，进入 TUI，确认状态栏显示 World Model 已连接。
2. 提出一个写入任务工作目录的小任务；检查主会话是否只委派，以及 F3 审批页是否准确展示文件与内容。
3. 先拒绝一次，确认没有产物且结果如实反映拒绝。另建任务批准一次，检查产物和主会话结果汇报。
4. 在待批准时停止并重启服务；确认会话、任务与待批准请求保留。批准后应继续旧工具调用。
5. 试用普通决定、指定时间任务、暂停/恢复计划、详情查询。普通决定不能替代操作批准。
6. 手动触发工作记忆整理，复核是否保留您的目标、限制、未决事项与承诺。这一项仍需要人的语义判断。

## 已取得的证据

| 级别 | 内容 | 结果文件 |
| --- | --- | --- |
| OFFLINE_RUNTIME | 去重、模型调用期间输入、角色/路径/同源边界、批准重启、未知停止、退休与反馈、排队调度、程序协议、整理覆盖、文件版本检查 | `reports/offline-tests.txt` |
| OFFLINE_RUNTIME | 独占锁、CAS、尾帧恢复、中段/对象损坏阻塞、真实 SIGKILL 后 ACK 保留 | 同上，`internal/store/store_test.go` |
| POSTGRES_RUNTIME | 真实临时 PG 上的仓储：幂等、版本冲突、等价支持、知识冲突、解决/撤回、类型验证及 outbox | `reports/postgres-tests.jsonl` |
| POSTGRES_RUNTIME | PG COMMIT 后 JSON 尚未完成的重启恢复、批准不重复消费、实际 transaction ID 交接 | `reports/postgres-bridge-tests.jsonl` |
| LIVE_MODEL | 两把 OpenCode Go 密钥分别驱动主会话/任务 agent，创建合成文件、批准、结果反馈与真实 Consciousness 整理 | `reports/live-model.json` |
| TUI_RUNTIME | 终端事件循环下的中文多行输入、授权确认、真实后台程序执行与结果详情、记忆页；重试身份和选择稳定性 | `reports/tui-tests.txt`、`reports/tui/` |

真实模型报告记录的是合成任务，未据此声称已经完成您的长期实际使用验证。没有物理掉电、复杂恶意程序隔离和摘要无遗漏的证明。

整理测试曾出现模型生成材料之外的证据引用，校验拒绝承接且保留原文，记录见 `reports/live-compaction-rejection.json`。随后改为由宿主解析模型返回的已有事件 ID；这减少引用格式错误，没有放宽证据归属检查。

## 本次实现选择

- 默认主会话和任务模型均为 `gpt-5.6-luna`；密钥独立、上下文独立、工具集合独立。
- agent loop 和工作记忆代码独立编写；界面依赖 tview/tcell，业务依赖涉及 JSON Schema、PostgreSQL 驱动和 Unix 系统调用。
- 默认本地端口 8787，数据 `.local/data`，任务目录 `.local/workspaces`。不对公网开放。
- 任务 agent 工具范围是任务目录文件操作；更广泛的执行通过人工登记程序接入。
- 阈值、30 分钟一次批准有效期、2 秒遗漏窗口和 48 小时任务保留均为可复核的 demo 选择，不提升为 BrainStorm 既定要求。
- 快照加速、程序内部现场恢复等边界在 ARCHITECTURE 明示；没有用结构验证假装它们已经实现。

## 停止与数据

`停止Secretary.command` 只停止本 demo 协调进程，不删除数据。若通过终端前台启动，使用 Ctrl-C。可单独 `./scripts/postgres.sh stop` 停止专用数据库。

`.private/runtime.env`、`.local`、`configs/local.json`、二进制均被 Git 忽略。本次没有提交 Git 或推送远端。

## 本次变更与清理

唯一交互入口已改为 TUI，旧 WebUI 文件和浏览器登录入口已移除。`reports/ui-review.json` 是旧版历史证据，不是当前终端界面的验收证据。旧 LIVE_MODEL 报告记录当时的业务链路；比较报告后的新模型记忆测试、状态边界修复和对应证据见顶部最新报告，均不冒充 Master 实际使用验证。

此前按 Master 指示，本地会话的测试对话、Consciousness、关联任务/审批及 workspace 已直接清理，不保留内容备份。API 配置和 PostgreSQL World Model 保留，范围见 `reports/test-data-reset.json`。本轮报告修复使用独立测试目录，没有再次清理实际会话资料。
