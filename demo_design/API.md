# 接口与通道

以下是应用内服务的建议 HTTP/工具映射，不意味着对公网开放。读取与写入都由服务端绑定 principal；只有可对外提交的 command DTO 能进入写接口，不能提供“上传任意 state JSON”入口。

| 调用方 / 入口 | 请求与返回 | 权威处理方 |
| --- | --- | --- |
| Master UI `POST /v1/inputs` | 原文/附件引用 + request_id；返回 CommandReceipt/Input ID | ingress，可靠保存后 ACK |
| UI `GET /v1/session`、`GET /v1/events?after=...` | 已保存会话/事件投影；游标断线重连 | session/operationlog，事件推送仅提示 |
| 主会话 `memory_read` | MemoryReadRequest → MemoryReadResult | memory；是本轮工具返回 |
| 主会话 `memory_propose_change` | WorldChange 或 WorldCatalogChange → CommandReceipt | worldmodel 后端 + Scheduler 统一授权 |
| 主会话 `task_propose` | TaskProposal → CommandReceipt/task_id | scheduler |
| 主会话 `task_query` | TaskQuery → TaskQueryResult | scheduler；DETAIL 才计活跃查询 |
| 主会话 `task_control` | TaskControlCommand → CommandReceipt | scheduler；普通决定与计划控制，无批准动作 |
| 主会话 `MasterInteract` | channel、message、稳定 request_id → Notification ID | interaction；普通通知/普通工作问题 |
| UI `GET /v1/approvals` | 当前待批准记录及固定 display_ref、display_hash | authorization；不等主会话调用 |
| UI `POST /v1/approvals/decisions` | ApprovalCommand → CommandReceipt | authorization；认证 MasterPrincipal 必须来自 session |
| UI `PUT /v1/authorization-rules/{id}` | 当前 revision + 规则草案 → 持久化 AuthorizationRule | 仅 Master UI；每条持续规则明确确认 |
| 人工 CLI `program validate/import/enable/disable` | ProgramRegistration 候选/ID/version → 登记回执 | registry；主会话没有此工具 |
| worker `POST /v1/worker/operations` | action/资源/参数对象与业务 intent → Operation ID/status | gateway；scope、attempt、epoch 由已认证分派绑定 |
| worker `POST /v1/worker/receipts` | WorkerReceipt → ACK | executor；拒绝冒充另一 attempt |
| worker `POST /v1/worker/checkpoints` | Checkpoint 候选 + 完整材料流 → ACK | executor/checkpoint；宿主自行保存原文 |
| worker `POST /v1/worker/results` | TaskResult/ProgramResult 候选 → ACK | scheduler；结果审查和归档先于反馈 |

Input、Notification、Operation 的持久化 schema 含服务端字段；UI/worker 只提交上表列出的业务字段。内部工具调用可用 Go 接口，不要求全部绕 HTTP。所有入口提交 DTO 校验后由宿主填 schema_version、record_type、hash、state、revision 等，不接受模型自行设定这些控制值。

`request_hash` 是首次入口原始业务请求字节的摘要，排除由服务端补充的 request_hash/state/revision 等字段；入口原始 bytes 保存在日志对象。schema 示例是补全后的持久化请求封装，不用于对含自身 hash 的整个封装再次求 hash。重复 request_id 必须与原始业务字节一致；相同业务但换了字段顺序也按不同 bytes 处理，客户端重投保留原请求。

身份/参数错误返回 400/403；版本或同键不同内容返回 409；未找到 404；旧执行 RETIRED 返回 410 并附历史引用；不可用 503。结果未知是领域状态，返回对象必须明确 `RESULT_UNKNOWN`，不伪装为可随意重试的通用 500。HTTP 超时客户端应查询 receipt 或使用原请求重投。

## 受控操作登记

动作名必须在 ToolBackend 注册表存在。初始类型举例 `file.write`、`program.run`、`world.change`，实现时仅启用实际支持者。每个类型给出参数 schema、资源规范化方法、关键参数摘要、前提检查和结果核验方法。resource_prefix 匹配必须按规范化后的路径段或资源 ID 边界，不能让 `/a` 自动覆盖 `/ab`。拒绝 symlink 越界；共享账号下程序自身的任意行为不由该字符串检查形成 OS 隔离。

规则匹配只产生候选放行依据，实际 Execute 前再次 gate。批准与具体 action/resource/parameter_hash/intent 绑定；主会话陈述和历史日志里的批准不被接受。worker 读取批准状态后也不能直接绕开 gate 执行动作。

## 事件命名与内容

| event_type 类别 | 完整 payload |
| --- | --- |
| input.accepted / input.handled | 原始输入或处理引用、input/loop 标识 |
| model.request / model.response / model.interrupted | 实际 Context 原件、完整返回或未完成说明 |
| tool.request / tool.result | 工具名、调用 ID、完整参数/返回、操作引用 |
| consciousness.candidate / consciousness.committed / consciousness.failed | 固定材料、候选、交接集合、失败依据 |
| task.proposed / task.initialized / execution.dispatched / execution.changed | 提案原件、目录归属、dispatch 与状态变化依据 |
| operation.prepared / operation.dispatched / operation.result / operation.unknown | 绑定参数/范围、执行意图、回执/未知依据 |
| authorization.requested / authorization.decided / authorization.consumed | UI 展示原件、Master 决定和消费关联 |
| decision.requested / decision.answered / feedback.delivered | 普通决定与结构化反馈 |
| program.started / program.stdout / program.stderr / program.result | 原始输入、相关环境、字节流块顺序、退出码、结果证据 |
| world.change_committed / world.change_conflict / world.change_rejected | PG outbox 中的前后变化及原始依据 |
| notification.queued / notification.result / archive.verified | 通知正文/投递回执、归档 manifest |

`event_type` 在实现中登记，不自动把未知字符串解释为可执行指令。actor 由入口身份赋值。日志 event sequence 和 journal transaction sequence 是两个独立递增序列，一帧可含多条事件；查询不得互换游标。

## 程序启动也是受控操作

PROGRAM 分派在启动程序前建立 `program.run` Operation，参数包含程序 id/revision/code_digest、工作目录、输入和声明的整体能力范围。没有授权时 Execution 从 READY 转 WAIT_AUTH，不运行程序。最终 gate 的 Operation.DISPATCHED、批准消费、Execution.DISPATCHING 和 Dispatch 必须在同一 journal 帧；随后才调用 exec。程序内部不能逐步检查的行为必须包含在人工登记/批准的整体范围内。AGENT 进程可以先启动，但任何受控任务工具仍经过同一 gateway。

ActionScope 一旦建立不能更换关键动作/参数。授权过期而动作未变可重新请求同一操作的批准；实际动作或目标版本实质改变时取消未分派旧操作、建立新 Operation，并关联旧意图用于去重/审计，不能原地篡改 Master 已看到的授权范围。

TaskProposal.reuse_task_id 明确指定“在现有计划内创建后续执行”；null 表示新计划。已接受的待决定执行使用 task_control 回答问题继续，不提交新执行伪装成恢复。具体接续前提统一见 JSON 语义约束。

尚未产生 execution_id 的提案与初始化事件使用 SYSTEM 流并携带 task_id；执行开始后工作记录进入 TASK 流且同时具有 task_id/execution_id。不能为了满足日志字段而伪造一个尚不存在的执行。
