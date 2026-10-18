# 记忆与提示词

## 请求组成

主会话的 [基础说明](../src/pi_secretary/src/instructions.ts) 按身份、Scope、任务委派、记忆、反馈与沟通分节。有效 UserInstructions 追加当前 Master 偏好，默认简体中文；Settings 接受最多 2000 个 Unicode 字符，相同内容保持版本，空内容停用自定义部分。Host 领取一批输入时保存 MainPromptSnapshot，冻结说明、工具声明和可用 Scope；恢复沿用该快照。

[主会话工具](../src/pi_secretary/src/main-tools.ts) 分为任务（task_propose/query/control）、记忆（memory_search/read/propose_change）、唤醒（schedule_wakeup/cancel_wakeup）和沟通（MasterInteract）。工具描述保存参数及用法，系统说明描述工作规则。Scope 列表最多 64 项、8 KiB，共享笔记以最多 8 KiB 的任务材料提供。

[执行提示词](../src/pi_secretary/src/task-prompt.ts) 使用 `secretary.agent-task.v1` 包，包含本轮完整目标、约束、验收项、材料、Scope 与恢复回执。执行器按 submit_result 提交结果；资料、共享笔记和历史输出作为任务数据传入。摘要与 Settings 使用 [summary](../src/pi_secretary/src/summary.ts)、[settings-memory](../src/pi_secretary/src/settings-memory.ts) 的固定来源整理流程。

## 工作记忆与来源

Consciousness 保存当前工作摘要、承诺和覆盖引用；MemoryExtractionJob 保存完整来源、事件身份、成功分段及补提时间。CHECKPOINT 保存恢复上下文，MODEL_REQUEST 保存预算投影后的请求，来源通过 context、事件和记忆版本关联。

[普通维护](../src/pi_secretary/src/memory-maintenance.ts) 在累计 8 个完成轮次或首个未覆盖轮次等待 60 秒后触发，间隔至少 120 秒；任务反馈可提前触发。上下文占用达到可用输入的 60% 时在安全边界整理，80% 为强制阈值，目标为 30%。整理固定来源期间新输入继续排队，提交候选时核对记忆版本与来源。

来源最多拆成 64 段，已成功候选跨重启复用。摘要成功即可提交，承诺提取独立推进；失败分段保留来源并补提，合并读取最新承诺账本。Settings 也遵循同一来源与投影规则，应用流程见[数据流](data-flow.md#记忆维护与设置)。

[MemoryCommitment](../src/pi_secretary/src/memory.ts) 保存稳定 ID、原文、状态、来源批次和处理凭证。结果汇报类承诺由匹配 TaskResult 及其后同会话的真实 `notification.presented` 证据完成，并校验来源批次、事件顺序及 sourceEnd；一般/复合承诺由 `memory/commitments/{id}/resolve` 明确处理。旧 ExtractionRecovery 仍可读取，新提取工作使用 MemoryExtractionJob。

## 原文退出与历史找回

[selectInputProjection](../src/pi_secretary/src/input-projection.ts) 统一处理普通整理、Settings 和重启后的输入选择。身份唯一、完整进入成功摘要或 APPLIED Settings、在当前轮次和工具协议保护区之外、且 PostgreSQL 检索水位追平的输入，才有退出资格。近期原文窗口默认最多 12 条，同时受可用预算的 15% 和剩余整理目标约束；整条过大时继续选择可容纳的更早原文。

退出回执保存冻结覆盖引用和有界窗口 ID；已退出原文保持在 journal/CAS，预算增大或 Settings 重建沿用既有退出事实。索引不可用时承接最后回执并暂停新增退出，未覆盖输入继续保留；提取失败不撤销成功摘要的覆盖。

| 工具 | 读取方式 |
| --- | --- |
| memory_search | [PostgreSQL 字面子串检索](../src/pi_secretary/src/memory-search.ts)：Master 输入、最终回复、任务摘要、通知正文；可筛时间 `[from,to)`、kinds、scope_id、task_id，默认 10、最多 20，按事件时间倒序，返回片段与 event_id |
| memory_read source=log | [journal/CAS 分片](../src/pi_secretary/src/main-tools.ts)：按 event_id，offset/length 使用 Unicode 码点，默认 2000、最多 4000，沿 next_offset 读取全文及 hash |
| memory_read source=consciousness | 当前工作记忆 |
| memory_read source=world | 按 subject（ID、名称或别名）、predicate 查询事实，歧义返回候选；默认 20、最多 100，cursor 续页 |
| memory_propose_change | 提交 ASSERT/CORRECT/RETRACT 与来源事件；更正/撤回携带 target_fact_id，由宿主组装合同并进入授权与 Settings |

检索状态区分 not_configured、未迁移、重建、故障和超时；落后结果提供 partial 与水位。工具返回受本轮剩余预算约束，缩短时带 truncated 和后续偏移。World 的 source_note 是解释，证据身份来自来源事件。

## 模型与维护重试

[durableStream](../src/pi_secretary/src/transport.ts) 对一次逻辑调用最多发送三次，间隔 2 秒、10 秒，更长 Retry-After 优先。网络、超时、408/409/429/5xx 与过载错误适用重试；认证、参数、容量和取消分别结束。尝试次数、请求身份和成功响应持久保存，恢复复用已有成功响应。

[维护退避](../src/pi_secretary/src/model-retry.ts) 在首次摘要/提取失败后，按 5 分钟、30 分钟、2 小时最多补试三轮；认证、容量与来源错误终止自动补试。`session/compact` 可重排摘要，`memory/extraction/retry` 重排受理时的失败提取集合。`GET memory` 查询进度，`memory/summary`、`memory/commitments` 分页读取内容。

## 容量与配置

[budget](../src/pi_secretary/src/budget.ts) 用归一化文本/JSON 的 UTF-8 字节上界与封装开销估算输入。可用输入为 `U = C − O − T − S`（窗口减输出、工具增长预留、安全余量），发送前检查 `I ≤ U`，实际 token usage 随调用记录。

| 环境变量 | 默认或用途 |
| --- | --- |
| SECRETARY_MAIN_CONTEXT_WINDOW / SECRETARY_MAIN_INPUT_TOKENS / SECRETARY_MAIN_OUTPUT_TOKENS | 主模型容量上限 |
| SECRETARY_TASK_CONTEXT_WINDOW / SECRETARY_TASK_INPUT_TOKENS / SECRETARY_TASK_OUTPUT_TOKENS | 任务模型容量上限 |
| SECRETARY_MAX_OUTPUT_TOKENS | 4096，普通输出目标 |
| SECRETARY_COMPACTION_OUTPUT_TOKENS / SECRETARY_COMPACTION_RETRY_OUTPUT_TOKENS | 16384 / 32768，首轮与后续摘要目标 |
| SECRETARY_TOOL_GROWTH_RESERVE | 4096 |
| SECRETARY_CONTEXT_SAFETY_TOKENS / SECRETARY_CONTEXT_SAFETY_RATIO | max(2048, 5% × C) |
| SECRETARY_COMPACTION_TARGET / SECRETARY_COMPACTION_THRESHOLD / SECRETARY_COMPACTION_FORCED_THRESHOLD | 0.30 / 0.60 / 0.80 |
| SECRETARY_RECENT_INPUT_MAX_COUNT / SECRETARY_RECENT_INPUT_BUDGET_RATIO | 12 / 0.15，范围 0–100 / 0–0.25 |
| SECRETARY_MEMORY_UPDATE_TURNS / SECRETARY_MEMORY_UPDATE_SECONDS / SECRETARY_MEMORY_MIN_INTERVAL_SECONDS | 8 / 60 / 120 |

这些参数进入 [Settings 运行配置指纹](../src/pi_secretary/src/settings.ts)，已有上下文通过整理和重建切换。主/任务请求都检查容量，超限保存上下文并进入 CAPACITY_BLOCKED。

## 唤醒输入

[schedule_wakeup](../src/pi_secretary/src/wakeups.ts) 接受显式时区的未来时间及最多 4 KiB 说明，最多 100 个 PENDING。到期保存 producer=TIMER 的 Input，正文带原定/实际时间、late_by_ms 和说明。TIMER 在队列、重放与 Settings 重建中保持身份；摘要及提取按真实输入身份区分 Master 和 TIMER。工具恢复使用稳定回执，主会话根据当前情况决定是否通知 Master。

## 当前限制

- 无 PostgreSQL 或检索未追平时暂停新增原文退出，长期对话可能达到 CAPACITY_BLOCKED。
- 当前容量校验适配 openai-completions 与 openai-responses，实际 payload 在发送前复检。
- 定时唤醒是单次定时器，FIRED/CANCELLED 历史尚未清理。
