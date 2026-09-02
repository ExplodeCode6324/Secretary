# execution.action_attempt

## 1. 定义

`action_attempt` 保存 Executor 对某个 Action 的一次真实执行尝试，包括 Worker、租约、请求与响应引用、外部回执、错误分类和结果摘要。它对应 Action Attempt 和 Action Result，不证明预期外部效果已经成立。

权威写入者为 Executor Result Handler。模型不得写入。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `attempt_id` | `uuid` | 是 | 主键 |
| `action_id` | `uuid` | 是 | 所属动作 |
| `attempt_no` | `integer` | 是 | 从 `1` 开始的单调序号 |
| `worker_id` | `text` | 是 | 执行实例标识 |
| `lease_id` | `uuid` | 是 | 有效 Worker Lease |
| `idempotency_key` | `text` | 是 | 实际提交给适配器的幂等键 |
| `execution_status` | `text` | 是 | `RUNNING`、`SUCCEEDED`、`FAILED` 或 `UNKNOWN` |
| `started_at` | `timestamptz` | 是 | 尝试开始时间 |
| `ended_at` | `timestamptz` | 否 | 尝试终止时间 |
| `request_ref` | `text` | 是 | 已脱敏、不可变请求引用 |
| `request_hash` | `text` | 是 | 实际请求哈希 |
| `response_ref` | `text` | 否 | 已脱敏、不可变响应引用 |
| `response_hash` | `text` | 否 | 响应内容哈希 |
| `external_receipt` | `jsonb` | 否 | 外部系统返回的唯一标识和命名空间 |
| `evidence_refs` | `uuid[]` | 是 | 执行过程证据 |
| `error_class` | `text` | 否 | `TRANSIENT`、`PERMANENT`、`AMBIGUOUS` 或 `POLICY_BLOCKED` |
| `error_code` | `text` | 否 | 稳定机器错误码 |
| `result_summary` | `jsonb` | 是 | 有界结构化结果，不含凭据 |
| `trace_id` | `uuid` | 是 | 跨层追踪标识 |
| `recorded_at` | `timestamptz` | 是 | 结果落库时间 |

## 3. 不可变量

1. `(action_id, attempt_no)` 唯一。
2. 尝试从 `RUNNING` 只能单调进入一个终止状态；终止后不得改写请求、响应或结果。
3. 网络超时、Worker 崩溃、响应丢失或租约过期且可能已产生副作用时，必须使用 `execution_status=UNKNOWN` 和 `error_class=AMBIGUOUS`。
4. `SUCCEEDED` 只表示 Executor 调用完成，不允许直接把 Action 更新为 `EFFECT_CONFIRMED`。
5. 实际 `idempotency_key` 和 `request_hash` 必须可与 Action Command 对账。
6. 原始请求和响应必须在持久化前完成 Secret 隔离与脱敏。

## 4. 关系与索引

- `action_id -> execution.action.action_id`。
- `lease_id -> execution.worker_lease.lease_id`。
- `evidence_refs[] -> ingestion.evidence_index.evidence_id`。
- 唯一索引：`(action_id, attempt_no)`。
- 对账索引：`(execution_status, error_class, ended_at)`。
- 外部回执索引建议从 `external_receipt` 提取来源与标识建立表达式索引。

## 5. 示例

```yaml
attempt_id: 0199a930-0000-7000-8000-000000000001
action_id: 0199a920-0000-7000-8000-000000000001
attempt_no: 1
worker_id: workspace-worker-2
lease_id: 0199a980-0000-7000-8000-000000000001
idempotency_key: secretary:datastructure:world-model-input:v1
execution_status: SUCCEEDED
started_at: 2026-09-02T05:20:00Z
ended_at: 2026-09-02T05:20:00.080Z
request_ref: object://attempts/0199a930/request.yaml
request_hash: sha256:35a1...
response_ref: object://attempts/0199a930/response.yaml
response_hash: sha256:a2c0...
evidence_refs: []
result_summary:
  exit_code: 0
  path: docs/datastructure/context/world-model-input.md
trace_id: 0199a930-0000-7000-8000-000000000099
recorded_at: 2026-09-02T05:20:00.090Z
```
