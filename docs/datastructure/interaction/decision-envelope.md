# DecisionEnvelope

## 1. 定义

`DecisionEnvelope` 是所有模型调用的统一结构化输出。它同时承载候选回复和机器可处理的决策提案，确保自然语言表述与提案状态可以独立校验。

Decision Envelope 不是任务、动作、授权、事实或外部效果的权威来源。合法封套必须先写入 `interaction.decision_record`，再由对应权威服务处理。

## 2. 顶层字段

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `schema_version` | `integer` | 是 | 初始为 `1` |
| `decision_id` | `uuid` | 是 | 必须等于 Model Invocation Service 预分配标识 |
| `response` | `object` | 是 | 候选回复内容和释放条件 |
| `decision` | `object` | 是 | 带类型区分器的决策分支 |
| `uncertainties` | `array<object>` | 是 | 影响判断的不确定性和所需补充信息 |
| `source_refs` | `array<object>` | 是 | 结论使用的输入记录精确引用 |

## 3. response

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `draft` | `string` | 是 | 候选回复文本 |
| `release_condition` | `object` | 是 | 类型和目标状态，不由模型判定已满足 |
| `claims` | `array<object>` | 是 | 回复中的关键状态声明及支持引用 |

`release_condition.type` 初始集合：`IMMEDIATE`、`TASK_COMMITTED`、`APPROVAL_GRANTED`、`EFFECT_CONFIRMED`、`TASK_COMPLETED`、`MANUAL_RELEASE`、`NEVER`。

涉及已开始、已授权、已发送、已删除、已支付、已修改或已完成的表述不得使用 `IMMEDIATE`。

## 4. decision

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `type` | `string` | 是 | 决策类型区分器 |
| `request_key` | `string` | 是 | 同一业务意图的稳定去重键 |
| `task_proposal` | `TaskProposal` | 条件 | `CREATE_TASK` 时填写 |
| `action_proposals` | `array<ActionProposal>` | 条件 | `CONTINUE_TASK` 时可填写 |
| `task_id` | `uuid` | 条件 | 继续、暂停或取消任务时填写 |
| `expected_task_version` | `integer` | 条件 | 对现有任务操作时填写 |
| `approval_request` | `object` | 条件 | `REQUEST_APPROVAL` 时填写 |
| `reason_code` | `string` | 是 | 受控原因码 |

决策类型：`RESPOND_ONLY`、`CREATE_TASK`、`CONTINUE_TASK`、`REQUEST_APPROVAL`、`PAUSE_TASK`、`CANCEL_TASK`。

## 5. 不可变量

1. `decision_id` 与外层审计记录标识必须相同。
2. `decision.type` 只能使用调用上下文允许的类型。
3. 分支字段必须与 `decision.type` 严格匹配，其他分支字段必须为空或不存在。
4. 回复中的关键状态声明必须列入 `claims` 并使用可验证来源或门控条件。
5. `request_key` 重试时保持稳定；业务语义改变时生成新键。
6. 模型不得输出凭据、Secret Reference 的解析值或未授权敏感原文。
7. Schema 合法不代表策略、状态或授权校验通过。

## 6. 示例

```yaml
schema_version: 1
decision_id: 0199aa10-0000-7000-8000-000000000001
response:
  draft: 任务已登记，我会先完成结构清单和权威边界设计。
  release_condition:
    type: TASK_COMMITTED
    subject_ref: pending-task-from-request-key
  claims:
    - claim_type: TASK_REGISTERED
      gate: TASK_COMMITTED
decision:
  type: CREATE_TASK
  request_key: secretary-datastructure-20260902
  task_proposal:
    schema_version: 1
    proposal_id: proposal-task-1
    goal: 完成 Secretary 各逻辑层数据结构设计
    success_criteria: []
    constraints: []
    priority: HIGH
    risk_class: REVERSIBLE
  reason_code: MASTER_REQUEST
uncertainties: []
source_refs:
  - type: INTERACTION_EVENT
    id: 0199aa00-0000-7000-8000-000000000001
```
