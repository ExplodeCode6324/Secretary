# TaskWorkingContext

## 1. 定义

`TaskWorkingContext` 是 Task-Step Invocation 为当前任务步骤重建的结构化输入。它只回答当前步骤下一步应做什么，不能替代 Task Store，也不承载完整任务历史。

该结构由 Task Context Builder 从 Task、Task Step、最新结果、必要 Artifact、相关实时状态和长期事实切片生成。

## 2. 字段

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `schema_version` | `integer` | 是 | 初始为 `1` |
| `context_id` | `uuid` | 是 | 本次工作上下文标识 |
| `generated_at` | `timestamp` | 是 | 构建时间 |
| `task` | `object` | 是 | `task_id`、精确版本、目标、成功条件、约束、优先级、风险和状态 |
| `current_step` | `object` | 是 | `step_id`、精确版本、目标、依赖、输入和预期输出 |
| `criteria_status` | `array<object>` | 是 | 每个成功条件的当前验证状态和证据引用 |
| `latest_results` | `array<object>` | 是 | 当前步骤直接需要的 Action Result 或 Verification Result 摘要 |
| `artifact_refs` | `array<object>` | 是 | 必要 Artifact 的精确版本引用 |
| `live_world_state` | `LiveWorldStateInput` | 是 | 与本步骤相关的实时状态切片 |
| `world_model` | `WorldModelInput` | 是 | 与本步骤相关的长期事实切片 |
| `approval_context` | `array<object>` | 是 | 可用授权的标识、精确版本、范围和剩余额度 |
| `retry_context` | `object` | 是 | 尝试次数、错误分类、幂等限制和对账状态 |
| `allowed_operations` | `array<object>` | 是 | 本步骤允许提案的工具操作 |
| `budget` | `object` | 是 | 输入、产物展开和输出预算 |
| `coverage` | `object` | 是 | 未载入历史、产物或证据的说明 |
| `integrity` | `object` | 是 | 各组成版本和最终载荷哈希 |

## 3. criteria_status

每项成功条件至少包含：

```yaml
criterion_id: all-structures-documented
statement: 每个数据结构均有独立文档
status: IN_PROGRESS
verification_method: FILE_INDEX_AND_LINK_CHECK
evidence_refs: []
```

状态初始集合为 `PENDING`、`IN_PROGRESS`、`SATISFIED`、`REJECTED`、`BLOCKED`。只有 Verifier 或 Task Service 能把条件确认结果写回 Task。

## 4. retry_context

`retry_context` 至少包含：

| 字段 | 类型 | 语义 |
|---|---|---|
| `step_attempt_count` | `integer` | 已执行的步骤轮次 |
| `last_action_status` | `string|null` | 最近动作状态 |
| `last_error_class` | `string|null` | 最近错误分类 |
| `result_unknown_present` | `boolean` | 是否存在必须先对账的未知效果 |
| `reusable_idempotency_keys` | `array<string>` | 可安全复用的幂等键；默认空 |
| `prohibited_retries` | `array<uuid>` | 禁止盲目重试的 Action |

## 5. 不可变量

1. Task 和当前 Step 必须使用读取时的精确版本；模型返回后由 Task Service 再次检查版本。
2. `result_unknown_present=true` 时，允许的下一步只能是验证、对账、等待或升级处理，不能重复副作用动作。
3. `approval_context` 只表示可供 Action Service 复核的候选授权，不代表模型拥有授权。
4. 完整任务日志不得进入该结构。只加载当前步骤必要的最新结果、Artifact 和证据引用。
5. Live World State 与 World Model 必须使用各自独立投影契约，不能合并为无时间语义的自由文本。
6. 未载入的历史或证据必须在 `coverage` 中声明，模型不得把缺失理解为不存在。
7. 载荷在模型调用前必须完成 Schema 校验、版本检查、访问控制和 Secret 扫描。

## 6. 输出

模型输出使用 [`DecisionEnvelope`](../interaction/decision-envelope.md) 的 `CONTINUE_TASK`、`REQUEST_APPROVAL`、`PAUSE_TASK` 或 `CANCEL_TASK` 分支，并可嵌入 [`ActionProposal`](../execution/action-proposal.md)。
