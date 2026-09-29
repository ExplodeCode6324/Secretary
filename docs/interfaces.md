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

批准前必须展示完整请求，版本/内容变化后重新展示。聊天文字不能代替批准按钮或命令。终端与 Web 的通用命令共用 TerminalController；World 管理及说明草稿使用受认证的专用 API，并共用 Settings 后端。TUI 状态和提示符显示设置应用阶段及输入排队状态，`/web` 可进入管理与恢复页面。

## 本机 HTTP API

[backend.ts](../src/pi_secretary/src/backend.ts) 仅监听 127.0.0.1，校验 Host / Origin；API 使用 endpoint 文件的 bearer token，不是公开服务或多用户权限系统。

| 路径 | 用途 |
| --- | --- |
| /api/health | 读取实例、模型模式 |
| /api/client | POST 创建 UI 客户端状态 |
| /api/state / /api/poll | 读取状态和输出 |
| /api/message / /api/command | POST 输入或 Master 命令 |
| /api/approval / /api/presented | POST 批准决定或通知展示回报 |
| /api/instructions | 读取有效说明或 POST 保存说明草稿 |
| /api/world | GET 分页查询当前/历史事实及管理目录 |
| /api/settings、/draft、/apply、/retry、/restore | 草稿及统一生效管理；完整路径与请求见 [设置规范](settings-activation.md) |
| /api/migrate / /api/shutdown | POST 迁移或正常停机 |

客户端请求体上限 1 MiB，闲置客户端约一小时清理。具体 body 字段以 backend 分支和 web/app.js 调用为准；没有承诺稳定的外部 HTTP SDK。

## 登记程序

`/register-example` 登记示例；`/register {"entrypoint":"绝对路径","name":"名称"}` 登记 Node 脚本。派发前检查 revision 与代码 SHA-256。stdin 接收 ProgramInvocation JSON，stdout 输出 ProgramResult JSON，stderr 保存日志。授权以整个程序执行范围为单位，当前 `supports_resume=false`，没有任意程序现场恢复。

## 同任务接续

`task_propose` 的 `reuse_task_id` 与 `parent_execution_id` 同时非空时，在同一 Task 内登记一次即时执行。parent 必须是该任务最新已结束且尚未回收的执行；任务有活跃执行、待执行请求、已到期周期工作或未知操作时拒绝。非空 reuse 缺 parent 返回 `PARENT_REQUIRED`，复用失败不降级为新任务。只填 parent 保持原有新任务引用旧材料的语义。

`goal` 是本轮完整目标；constraints、acceptance_criteria、deadline 省略或 null 从 parent 快照继承。显式数组完整替换该字段，空 constraints 有效，空 acceptance 拒绝。program_id 省略继承执行器，显式改变执行器拒绝；PROGRAM 保留原版本及参数，只把 goal 更新为本轮目标。复用不能传 at / interval_seconds。材料不具备修改正式要求的权威。

回执仍包含 TaskPlan，并增加 acceptance 关联（request_id、task_id、occurrence_key、proposal_ref、execution_id 与当前状态）。尚未分派的 execution_id 为 null；旧版回执可能只有计划关联。同 ID 重投返回原受理，不重新接受。

`task_query` 无参数提供可读任务列表；task_id 返回计划基线、最近执行要求、结果、产物、待决定事项、can_continue 与阻止原因；execution_id 保持执行详情入口。两个 ID 同时传入返回 `AMBIGUOUS_QUERY`。列表不刷新留存，具体热执行详情刷新；RETIRED 不重新激活。受理端重新验证权限和接续条件。

`task_control` 增加 `cancel_request`，id 为已受理即时请求的 request_id。未分派时原子移除待执行项、释放 parent 并登记取消原因；已分派则进入现有执行取消流程。重复取消幂等；已取消请求重投不会再次执行。AT / INTERVAL 的计划请求不使用此入口。
