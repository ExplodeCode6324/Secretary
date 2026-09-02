# execution.action

## 1. 定义

`action` 保存经 Schema、Policy、State 和 Approval Gate 校验后形成的原子动作指令。它对应 Action Intent 和 Action Command，描述系统准备执行什么、基于哪些前置条件、预期产生何种效果以及如何验证。

权威写入者为 Action Service。LLM 只能输出 Action Proposal，不能直接创建可执行命令。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `action_id` | `uuid` | 是 | 主键 |
| `task_id` | `uuid` | 是 | 所属任务 |
| `step_id` | `uuid` | 是 | 所属步骤 |
| `proposal_decision_id` | `uuid` | 是 | 提出动作的模型或规则决策 |
| `tool` | `text` | 是 | Executor Adapter 稳定名称 |
| `operation` | `text` | 是 | 工具内原子操作 |
| `arguments_ref` | `text` | 是 | 不可变、已脱敏参数对象引用 |
| `arguments_hash` | `text` | 是 | 规范化参数哈希 |
| `preconditions` | `jsonb` | 是 | 带类型、资源版本和失败策略的前置条件列表 |
| `expected_effect` | `jsonb` | 是 | 可观察、可验证的目标效果 |
| `verification_plan` | `jsonb` | 是 | 验证方法、读取来源、成功判据和超时 |
| `risk_class` | `text` | 是 | 六级风险分类 |
| `approval_id` | `uuid` | 否 | 需要授权时的有效 Approval |
| `idempotency_key` | `text` | 是 | 外部副作用去重键 |
| `status` | `text` | 是 | 采用动作状态机 |
| `max_attempts` | `integer` | 是 | 正整数；不代表允许盲目重试 |
| `next_attempt_at` | `timestamptz` | 否 | 退避后的最早执行时间 |
| `version` | `bigint` | 是 | 乐观并发版本 |
| `created_at` | `timestamptz` | 是 | 创建时间 |
| `updated_at` | `timestamptz` | 是 | 最近更新时间 |

动作状态：`PENDING`、`DISPATCHED`、`RUNNING`、`EXECUTION_SUCCEEDED`、`EXECUTION_FAILED`、`RESULT_UNKNOWN`、`VERIFYING`、`EFFECT_CONFIRMED`、`EFFECT_REJECTED`、`CANCELLED`。

## 3. Preconditions 约定

每项前置条件至少包含：

```yaml
condition_id: target-version
type: RESOURCE_VERSION_EQUALS
resource_ref: file:docs/Design.md
expected:
  version: sha256:0b9e...
on_failure: STOP_AND_REPLAN
```

不满足前置条件时必须停止并重新读取状态，禁止继续使用过期上下文。

## 4. 不可变量

1. `(tool, operation, idempotency_key)` 在幂等有效窗口内唯一。
2. 进入 `DISPATCHED` 前必须完成参数 Schema、策略、状态和授权校验。
3. `approval_id` 的范围、风险等级、资源、次数和有效期必须覆盖该动作。
4. `RESULT_UNKNOWN` 只能进入验证或对账流程，不能直接再次执行。
5. `EFFECT_CONFIRMED` 必须有独立验证依据。
6. `arguments_ref` 不得指向含长期凭据的对象；执行器只使用短时 Credential Handle。
7. 动作内容变化必须生成新 Action，不得复用旧 `idempotency_key` 修改语义。

## 5. 关系与索引

- 引用 Task、Task Step、Decision Record 和 Approval。
- 被 Action Attempt、Observation、Evidence 和 Task Event 引用。
- 唯一索引：`(tool, operation, idempotency_key)`。
- 调度索引：`(status, next_attempt_at, created_at)`。
- 任务索引：`(task_id, step_id, created_at)`。

## 6. 示例

```yaml
action_id: 0199a920-0000-7000-8000-000000000001
task_id: 0199a900-0000-7000-8000-000000000001
step_id: 0199a910-0000-7000-8000-000000000001
proposal_decision_id: 0199aa10-0000-7000-8000-000000000001
tool: workspace.patch
operation: create_document
arguments_ref: object://actions/0199a920/arguments.yaml
arguments_hash: sha256:35a1...
preconditions:
  - condition_id: target-absent
    type: PATH_ABSENT
    resource_ref: docs/datastructure/context/world-model-input.md
    on_failure: STOP_AND_REPLAN
expected_effect:
  type: FILE_PRESENT_WITH_HASH
verification_plan:
  methods:
    - INDEPENDENT_READBACK
risk_class: REVERSIBLE
idempotency_key: secretary:datastructure:world-model-input:v1
status: PENDING
max_attempts: 2
version: 1
created_at: 2026-09-02T05:10:00Z
updated_at: 2026-09-02T05:10:00Z
```
