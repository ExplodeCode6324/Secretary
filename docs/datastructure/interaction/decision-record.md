# interaction.decision_record

## 1. 定义

`decision_record` 保存一次 Decision Invocation、Task-Step Invocation 或 Verification Invocation 的输入引用、模型配置、结构化输出、校验结果和运行指标。它记录模型提出了什么，不证明提案已执行或事实已成立。

权威写入者为 Model Invocation Service。模型不能修改自己的审计记录。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `decision_id` | `uuid` | 是 | 主键 |
| `invocation_type` | `text` | 是 | `DECISION`、`TASK_STEP` 或 `VERIFICATION` |
| `trigger_type` | `text` | 是 | Interaction、Observation、Task Event 或 Schedule |
| `trigger_ref` | `uuid` | 是 | 触发记录标识 |
| `task_id` | `uuid` | 否 | 任务步骤或验证调用时填写 |
| `consciousness_snapshot_id` | `uuid` | 否 | 即时决策使用的意识快照 |
| `context_ref` | `text` | 是 | 实际模型输入的不可变引用 |
| `context_hash` | `text` | 是 | 规范化输入哈希 |
| `context_schema_version` | `integer` | 是 | 输入结构版本 |
| `model_provider` | `text` | 是 | 模型提供方逻辑标识 |
| `model_id` | `text` | 是 | 精确模型标识 |
| `model_parameters` | `jsonb` | 是 | 温度、输出约束等非 Secret 参数 |
| `prompt_template_version` | `text` | 是 | 系统模板版本 |
| `decision_envelope` | `jsonb` | 否 | 符合版本化 Schema 的结构化输出 |
| `envelope_schema_version` | `integer` | 是 | Decision Envelope 版本 |
| `request_key` | `text` | 是 | 调用级幂等键 |
| `validation_status` | `text` | 是 | `PENDING`、`VALID`、`INVALID` 或 `FAILED` |
| `validation_errors` | `jsonb` | 是 | 机器可读 Schema 或策略前置错误 |
| `input_tokens` | `integer` | 否 | 模型计量值 |
| `output_tokens` | `integer` | 否 | 模型计量值 |
| `started_at` | `timestamptz` | 是 | 调用开始时间 |
| `completed_at` | `timestamptz` | 否 | 调用结束时间 |
| `trace_id` | `uuid` | 是 | 跨层追踪标识 |

## 3. Decision Envelope 最小结构

```yaml
decision_id: 0199aa10-0000-7000-8000-000000000001
response:
  draft_ref: object://reply-drafts/0199ab00/content
  release_condition:
    type: TASK_COMMITTED
    subject_ref: 0199a900-0000-7000-8000-000000000001
decision:
  type: CREATE_TASK
  request_key: secretary-datastructure-20260902
  proposal:
    goal: 完成 Secretary 各逻辑层数据结构设计
    success_criteria: []
    constraints: []
    priority: HIGH
    risk_class: REVERSIBLE
```

初始决策类型：`RESPOND_ONLY`、`CREATE_TASK`、`CONTINUE_TASK`、`REQUEST_APPROVAL`、`PAUSE_TASK`、`CANCEL_TASK`。

## 4. 不可变量

1. `(invocation_type, request_key)` 唯一，重试必须复用同一结果或形成明确的新调用原因。
2. `context_hash` 必须覆盖模型实际收到的完整结构化输入，而不是仅覆盖数据库引用列表。
3. `validation_status=VALID` 只表示结构合法，不表示提案已获授权或执行。
4. Verification Invocation 的模型结论只能是候选验证结论，不能单独成为外部效果权威证据。
5. Prompt、Context、输出、指标和错误记录均不得包含 Secret。
6. 模型超时或无合法结构化输出时必须保留 `FAILED` 或 `INVALID` 记录。
7. Decision Envelope 创建后不可改写；修复必须产生新 Decision Record。

## 5. 关系与索引

- 引用 Consciousness Snapshot、Task 和各类 Trigger。
- 被 Task、Action、Approval 和 Reply Draft 引用。
- 唯一索引：`(invocation_type, request_key)`。
- 触发索引：`(trigger_type, trigger_ref)`。
- 模型审计索引：`(model_provider, model_id, started_at desc)`。
- 失败诊断索引：`(validation_status, started_at desc)`。

## 6. 示例

```yaml
decision_id: 0199aa10-0000-7000-8000-000000000001
invocation_type: DECISION
trigger_type: INTERACTION
trigger_ref: 0199aa00-0000-7000-8000-000000000001
consciousness_snapshot_id: 0199a860-0000-7000-8000-000000000001
context_ref: object://model-input/0199aa10/context.yaml
context_hash: sha256:d911...
context_schema_version: 1
model_provider: configured-provider
model_id: configured-model
model_parameters:
  structured_output: true
prompt_template_version: decision-template/v1
envelope_schema_version: 1
request_key: decision:turn-20260902-2
validation_status: VALID
validation_errors: []
started_at: 2026-09-02T05:10:00.100Z
completed_at: 2026-09-02T05:10:01.400Z
trace_id: 0199aa10-0000-7000-8000-000000000099
```
