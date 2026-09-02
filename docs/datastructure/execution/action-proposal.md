# ActionProposal

## 1. 定义

`ActionProposal` 是 Task-Step LLM 或规则系统提出的下一步原子动作候选。它尚未经过完整 Schema、Policy、State 和 Approval Gate，不可交给 Executor 执行。

## 2. 字段

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `schema_version` | `integer` | 是 | 初始为 `1` |
| `proposal_id` | `string` | 是 | Decision Envelope 内局部稳定标识 |
| `task_id` | `uuid` | 是 | 目标任务 |
| `expected_task_version` | `integer` | 是 | 模型读取的 Task 版本 |
| `step_id` | `uuid` | 是 | 目标步骤 |
| `expected_step_version` | `integer` | 是 | 模型读取的 Step 版本 |
| `tool` | `string` | 是 | 候选 Adapter |
| `operation` | `string` | 是 | 候选原子操作 |
| `arguments` | `object` | 是 | 符合工具提案 Schema 的无 Secret 参数 |
| `preconditions` | `array<object>` | 是 | 建议检查的资源状态 |
| `expected_effect` | `object` | 是 | 可观察的预期效果 |
| `verification_plan` | `object` | 是 | 独立验证方法和成功判据 |
| `proposed_risk_class` | `string` | 是 | 模型评估的风险下限建议 |
| `approval_requirement` | `object` | 是 | 是否预计需要授权及范围 |
| `deduplication_scope` | `object` | 是 | 业务对象和操作语义，用于 Action Service 生成幂等键 |
| `reason_code` | `string` | 是 | 受控提案原因 |

## 3. 不可变量

1. Proposal 不包含可执行 Credential Handle、最终 `action_id`、`attempt_id` 或最终幂等键。
2. Task 或 Step 版本变化后 Proposal 必须重新校验。
3. `expected_effect` 和 `verification_plan` 均为必填，不能只描述工具调用成功。
4. `proposed_risk_class` 不能约束 Policy Gate 降低最终风险等级。
5. `approval_requirement.required=false` 不构成免授权决定。
6. `RESULT_UNKNOWN` 未对账时不得提出重复副作用动作。

## 4. 持久化映射

通过全部 Gate 后，Action Service 将其转换为 [`execution.action`](action.md)，并生成 [`ActionCommand`](action-command.md)。原 Proposal 作为 Decision Envelope 的一部分保留在 Decision Record。
