# 提示词、记忆与模型预算

## 输入组成

主会话使用 [instructions.ts](../src/pi_secretary/src/instructions.ts) 的基础说明、有效 UserInstructions、工作记忆、历史和本轮输入。Host 领取输入时保存 MainPromptSnapshot，固定说明版本、工具声明与 Scope 名单，中断轮次按原快照恢复。

任务 Agent 使用 [task-prompt.ts](../src/pi_secretary/src/task-prompt.ts) 的 `secretary.agent-task.v1` 包，包含本轮提案、执行材料、绑定目录及共享笔记。摘要和设置使用 [summary.ts](../src/pi_secretary/src/summary.ts) 的分段整理流程。

owner 通过 Settings 修改自定义说明，最多 2000 个 Unicode 字符；相同内容保持版本，空内容停用自定义部分。应用过程见[Settings 生效](settings-activation.md)。

## 保存与投影

CHECKPOINT 保存完整恢复上下文；MODEL_REQUEST 保存经过预算投影的请求，关联原 context、记忆版本和整理任务。发送前使用独立消息数组投影，保留 system、工具协议、当前轮次与历史 Master 输入锚点。内部记忆身份标记用于恢复识别，适配器在实际发送时移除。

当前 Master 历史原文仍随 context 保留；因此当前记忆测试验证的是摘要、原文与持久状态共同支持的连续性。#21 交付检索后，#28 再启用旧输入退出。

## 工作记忆与上下文整理

| 模式 | 触发与结果 |
| --- | --- |
| WORKING_MEMORY | 累计 8 个完成轮次或首个未覆盖轮次等待 60 秒；普通维护间隔至少 120 秒。更新 Consciousness 和覆盖水位 |
| CONTEXT_COMPACTION | 可用输入占用达到 60% 时在安全边界整理，80% 为强制阈值；目标 30%，裁剪已进入成功记忆的历史 |

已完成任务反馈可提前触发维护。固定来源整理期间，新输入继续排队；候选提交时检查记忆版本与来源事实。`POST /api/v1/session/compact` 发起显式维护；多来源历史使用完整来源整理流程。

摘要来源最多拆成 64 段，每段每轮生成一个候选，已成功分段保存后可跨重启复用。摘要首轮输出目标 16384，后续维护轮次目标 32768，均受实际模型与配置上限约束。需要保留的内容超过输入预算时返回 CAPACITY_BLOCKED，并保存原始上下文供处理。

## 传输重试与维护补试

单次逻辑模型调用最多三次物理发送，间隔为 2 秒、10 秒；更长的 Retry-After 优先。网络、超时、408/409/429/5xx 和过载错误适用重试，认证、格式、容量和取消按具体原因结束。ModelCall 保存尝试序号、请求身份、诊断和成功响应；重启沿用已用次数，已保存成功响应直接复用。

摘要或提取的首次维护失败后，按 5 分钟、30 分钟、2 小时最多补试三轮。认证、容量和来源错误等终止自动补试。session/compact 可重新安排摘要；`memory/extraction/retry` 重新安排受理时的失败提取集合。后台 tick 与普通重启保留原有次数。

## 承诺与来源

MemoryExtractionJob 独立保存完整来源引用、事件身份、成功分段和下次补提时间。摘要或 Settings 成功后，提取工作仍可从 journal/CAS 继续。成功提取按当前账本去重合并，已解决的承诺保持其状态。

MemoryCommitment 保存稳定 ID、原文、状态、来源批次和处理凭证。结果汇报类承诺可由匹配 TaskResult 及其后的 SENT 通知完成；一般承诺通过 `memory/commitments/{id}/resolve` 明确处理。当前 API 提供通知内容读取，展示回执入口将在后续送达工作中补齐。

来源按事件、批次、会话与完整消息身份关联；同一文本在不同事件中分别记录。旧来源无法唯一映射时返回具体原因，可从记忆状态查询并人工处理。旧 ExtractionRecovery 继续支持历史读取，新工作使用 MemoryExtractionJob。

## 容量与配置

[budget.ts](../src/pi_secretary/src/budget.ts) 按归一化文本/JSON 的 UTF-8 字节上界及封装开销估算输入，包括 system、工具声明、记忆、历史和工具返回。可用输入为 `U = C − O − T − S`：有效窗口减去输出、工具增长预留和安全余量；发送前检查 `I ≤ U`。这是字节上界估算，实际 token usage 随每次调用记录。

| 环境变量 | 默认或用途 |
| --- | --- |
| SECRETARY_MAIN_CONTEXT_WINDOW / SECRETARY_MAIN_INPUT_TOKENS / SECRETARY_MAIN_OUTPUT_TOKENS | 主模型服务容量上限 |
| SECRETARY_TASK_CONTEXT_WINDOW / SECRETARY_TASK_INPUT_TOKENS / SECRETARY_TASK_OUTPUT_TOKENS | 任务模型服务容量上限 |
| SECRETARY_MAX_OUTPUT_TOKENS | 4096，普通输出目标 |
| SECRETARY_COMPACTION_OUTPUT_TOKENS | 16384，摘要首轮目标 |
| SECRETARY_COMPACTION_RETRY_OUTPUT_TOKENS | 32768，后续摘要目标 |
| SECRETARY_TOOL_GROWTH_RESERVE | 4096，含工具时预留 |
| SECRETARY_CONTEXT_SAFETY_TOKENS / SECRETARY_CONTEXT_SAFETY_RATIO | 默认 max(2048, 5% × C) |
| SECRETARY_COMPACTION_TARGET / SECRETARY_COMPACTION_THRESHOLD / SECRETARY_COMPACTION_FORCED_THRESHOLD | 0.30 / 0.60 / 0.80 |
| SECRETARY_MEMORY_UPDATE_TURNS / SECRETARY_MEMORY_UPDATE_SECONDS / SECRETARY_MEMORY_MIN_INTERVAL_SECONDS | 8 / 60 / 120 |

这些参数纳入运行配置指纹，经 Settings 完成已有上下文切换。当前容量验证适配 openai-completions 与 openai-responses，实际 payload 在发送前再检查；task 同样检查容量，超限时保留 checkpoint。

## 查询与验证

`GET /api/v1/memory` 提供维护与补提状态；`memory/summary`、`memory/commitments` 提供分页内容及来源。`requests/{id}` 提供维护命令的受理对账。

当前离线覆盖见[测试策略](testing.md)，已有真实模型及跨进程连续性结果见带日期的 [API 验证记录](api/v1/verification.md)。
