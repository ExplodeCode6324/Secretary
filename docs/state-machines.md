# 状态与调度

状态枚举来自[内部 Schema](../src/contracts/contracts.schema.json)。各领域模块检查转换条件；Authorization.decide 使用状态目录的转换函数，其他模块以自己的业务逻辑推进。统一状态机校验安排在 #25。

## 主会话与模型调用

Input 受理后为 ACCEPTED，由 Host 组成固定批次处理，完成后为 HANDLED。处理中保存 MainPromptSnapshot、Context 和 ModelCall。恢复时复用已持久化的成功响应与工具结果，按逻辑调用的已用次数继续未完成请求。

单次逻辑模型调用最多发送三次，重试间隔为 2 秒、10 秒；供应商更长的 Retry-After 优先。网络错误、超时、408/409/429/5xx 等暂时错误适用重试；认证、参数、容量或取消走对应错误处理。需要人工恢复的主会话可通过 session/resume 处理；新的 Master 输入也可唤醒传输失败后阻塞的原批次。

## 任务与 Scope

TaskPlan 支持 IMMEDIATE、AT、INTERVAL。即时工作在 `pending_requests` 中保存 request_id、occurrence_key、due_at 和 proposal_ref，周期工作使用 `pending_occurrences`。Scheduler 按到期与前置条件创建、派发 Execution。

| 阶段 | 含义 |
| --- | --- |
| CREATED / WAIT_PRECONDITION | 已创建，准备或等待前置条件 |
| READY / DISPATCHING / RUNNING | 可派发、派发中或执行中 |
| WAIT_AUTH / WAIT_DECISION | 等待作用许可或工作回答 |
| CANCEL_REQUESTED | 已收到取消，正在停止 |
| RESULT_UNKNOWN | 一项或多项作用结果待确认 |
| SUCCEEDED / FAILED / CANCELLED / EXPIRED | 本次执行结束，生成结果与反馈 |

DIRECTORY 在 DISPATCHING、RUNNING、WAIT_AUTH、WAIT_DECISION、CANCEL_REQUESTED，以及已启动的 READY 阶段保持占用；待确认进程和仍在运行的调用也保持占用。取得占用与写入派发状态发生在异步启动之前。同一 DIRECTORY 串行，NONE 范围内各任务可并行；默认全局执行者为 2。

Scope 从 ACTIVE 归档为 ARCHIVED。归档后停止接受该范围的新提案和未启动工作，已取得占用的执行继续完成。根目录、类型的更新影响未来 Execution；已创建的绑定保持原值。前置条件可返回 SCOPE_BUSY、SCOPE_ARCHIVED、SCOPE_ROOT_CONFLICT。

结束执行先保留 HOT，满足留存条件后保存归档清单并转 RETIRED；默认保留窗口 48 小时，显式 viewed 可续留。历史记录仍保存在 Store。

## Operation 与未知结果

Operation 在授权、派发和结果保存过程中记录 state 与 effect。状态表示处理进度，effect 表示作用结论。未知 shell/program 影响所属执行；未知文件写入还按绝对资源路径影响其他执行的写入。

| owner 裁定 | Operation state / effect | 含义 |
| --- | --- | --- |
| APPLIED | SUCCEEDED / APPLIED | 作用已发生 |
| NOT_APPLIED | FAILED / NOT_APPLIED | 作用未发生 |
| PARTIAL | FAILED / PARTIAL | 部分发生 |
| UNVERIFIED | FAILED / UNKNOWN | 已记录人工处理，效果仍未核实 |

裁定附原 revision、note 和 request_id，保留原始回执。文件写入还可通过 verify-write 比对绑定根与预期内容，确认 APPLIED。最后一个未知项处理后，Scheduler 等待进程停止，将原 RESULT_UNKNOWN 执行收束为 FAILED，并保存一份 TaskResult 与 Feedback。继续工作使用新的任务请求。

## 进程生命周期

shell/program 的 wrapper 先报告就绪身份；Core 持久保存后才发送启动指令。启动前 STOP 或通道断开会返回 not_started，作用记为 NOT_APPLIED。启动后以明确 outcome 帧记录命令结果；wrapper 自身的退出码和缺失的结果帧分别处理。

Core 断开后，wrapper 向进程组发 TERM，2 秒后仍存活则发 KILL。重启恢复读取 journal 中的进程身份：

1. 系统启动标识已变，或进程组不存在：记录已停止。
2. 进程组存在且身份一致：TERM，2 秒后仍在则 KILL，再次检查。
3. 身份不一致或无权限检查：保留占用和待处理原因。

每次发信号前重新检查身份。恢复使用系统进程信息与 journal，不重连旧 wrapper。

## 记忆与设置

WORKING_MEMORY 更新摘要与覆盖水位，CONTEXT_COMPACTION 保存模型输入裁剪结果。MemoryExtractionJob 独立维护固定来源、成功分段和补提次数；首次失败后依次等待约 5 分钟、30 分钟、2 小时补试三轮，耗尽后显示 FAILED。人工 extraction/retry 重排受理时的失败集合，同 request_id 重放原回执。

SettingsApplication 先从 QUEUED 进入 SUMMARIZING；包含 World 变更时经 COMMITTING 提交数据库事务，否则直接进入 REBUILDING，完成本地重建后为 APPLIED。提交前的确定失败为 FAILED；提交结果待确认或已提交但重建未完成为 BLOCKED。恢复根据数据库批次回执推进。详见[设置生效](settings-activation.md)。

ApiCommand 的短命令状态通常保持 ACCEPTED，业务进度从关联资源读取。长命令为 QUEUED → RUNNING → COMPLETED，中断或派发异常记录 UNKNOWN。
