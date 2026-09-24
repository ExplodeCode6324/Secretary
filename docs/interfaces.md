# 工具与接口

## 主会话工具

| 工具 | 代码职责 |
| --- | --- |
| task_propose | 提交带目标、材料、约束和验收项的任务 |
| task_query | 查询计划、执行和结果；详情查询会刷新留存 |
| task_control | 按当前协议控制任务，不产生授权决定 |
| memory_read | 读取受支持的记忆、原件或 World 数据 |
| memory_propose_change | 提交 World 变更提案，不能直接绕过授权提交 |
| MasterInteract | 创建面向 Master 的通知 |

权威参数定义在 [Host.tools](../src/pi_secretary/src/host.ts)；持久协议字段在 [数据索引](data/README.md)。工具读取 World 而未配置数据库时明确不可用。

## 执行 Agent 工具

`read` / `write` 限制任务 workspace 的相对路径并检查越界；write 走最终授权 gate。`bash` 为真实 shell，默认在工作目录执行，以当前用户运行且可访问网络，不能当作沙箱。`request_decision` 保存工作决定并等待；它不替代授权。`submit_result` 必须提交每项验收评估、局限和产物，普通文本回复不完成任务。

shell 默认 120 秒，允许 0.1–3600 秒；stdout/stderr 各限 4 MiB。超时、取消或超限终止进程组并保留未知结果。正常退出保存 exit_code，非零码仍是失败证据。子进程环境采用明确白名单，不继承模型 API key。

## Master 操作入口

TUI `/help` 列出命令；常用 `/status`、`/tasks`、`/show`、`/task`、`/program`、`/auth`、`/approval`、`/approve`、`/reject`、`/revoke`、`/decisions`、`/answer`、`/cancel`、`/verify`、`/memory`、`/compact`、`/resume`、`/world`、`/register`、`/rule`。A1/D1 等是客户端内短编号，不能跨重启当作持久 ID。

批准前必须展示完整请求，版本/内容变化后重新展示。聊天文字不能代替批准按钮或命令。终端与 Web 共用 TerminalController 的执行路径。

## 本机 HTTP API

[backend.ts](../src/pi_secretary/src/backend.ts) 仅监听 127.0.0.1，校验 Host / Origin；API 使用 endpoint 文件的 bearer token，不是公开服务或多用户权限系统。

| 路径 | 用途 |
| --- | --- |
| /api/health | 读取实例、模型模式 |
| /api/client | POST 创建 UI 客户端状态 |
| /api/state / /api/poll | 读取状态和输出 |
| /api/message / /api/command | POST 输入或 Master 命令 |
| /api/approval / /api/presented | POST 批准决定或通知展示回报 |
| /api/instructions | 读取或 POST 保存用户说明 |
| /api/migrate / /api/shutdown | POST 迁移或正常停机 |

客户端请求体上限 1 MiB，闲置客户端约一小时清理。具体 body 字段以 backend 分支和 web/app.js 调用为准；没有承诺稳定的外部 HTTP SDK。

## 登记程序

`/register-example` 登记示例；`/register {"entrypoint":"绝对路径","name":"名称"}` 登记 Node 脚本。派发前检查 revision 与代码 SHA-256。stdin 接收 ProgramInvocation JSON，stdout 输出 ProgramResult JSON，stderr 保存日志。授权以整个程序执行范围为单位，当前 `supports_resume=false`，没有任意程序现场恢复。
