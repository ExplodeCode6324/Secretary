# TaskProposal

## 1. 定义

`TaskProposal` 是模型或规则系统提出的持久任务候选。Task Service 校验去重、来源、权限、风险、成功条件和约束后，才可创建 `execution.task`。

## 2. 字段

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `schema_version` | `integer` | 是 | 初始为 `1` |
| `proposal_id` | `string` | 是 | Decision Envelope 内局部稳定标识 |
| `parent_task_id` | `uuid` | 否 | 候选父任务 |
| `expected_parent_version` | `integer` | 条件 | 有父任务时填写 |
| `goal` | `string` | 是 | 明确目标 |
| `success_criteria` | `array<object>` | 是 | 带 `criterion_id`、陈述和验证方法的条件 |
| `constraints` | `array<object|string>` | 是 | 范围、行为、成本、时间和安全约束 |
| `priority` | `string` | 是 | `LOW`、`NORMAL`、`HIGH` 或 `CRITICAL` |
| `risk_class` | `string` | 是 | 六级风险分类 |
| `requested_wakeup` | `object|null` | 是 | 初始时间或事件唤醒条件 |
| `initial_step_hints` | `array<object>` | 是 | 非权威步骤建议，可为空 |
| `source_refs` | `array<object>` | 是 | 支持任务必要性的输入引用 |

## 3. success_criteria

每项至少包含：

```yaml
criterion_id: model-input-contracts
statement: Live World State 和 World Model 的模型输入结构均有独立定义
verification:
  type: DOCUMENT_AND_LINK_CHECK
  required_artifact_types:
    - DOCUMENT
```

成功条件必须可观察、可判定，不能使用尽量、适当、最好等无法机械解释的词作为唯一标准。

## 4. 不可变量

1. Proposal 不包含 Task 状态、Task ID 或已提交时间。
2. 风险等级只能保持或提高系统推断结果，不能由模型降低。
3. 子任务约束不得弱于父任务适用约束。
4. `initial_step_hints` 不是执行计划，Task Service 和 Orchestrator 可拒绝或重建。
5. Proposal 不构成外部动作授权。
6. Task Service 必须使用 Decision Envelope 的 `request_key` 实现幂等创建。

## 5. 持久化映射

校验通过后映射到 [`execution.task`](task.md)。`proposal_id` 保留在 Decision Record 中，Task 保存 `source_decision_id` 和 `request_key`，不把模型提案当作事实来源。
