# ActionResult

## 1. 定义

`ActionResult` 是 Executor Adapter 对一次 Action Command 的结构化执行结果。它描述实际尝试了什么、执行器观察到什么以及是否存在不确定性，不宣告预期外部效果已经确认。

## 2. 字段

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `schema_version` | `integer` | 是 | 初始为 `1` |
| `command_id` | `uuid` | 是 | 对应 Action Command |
| `action_id` | `uuid` | 是 | Action 标识 |
| `attempt_id` | `uuid` | 是 | Action Attempt 标识 |
| `worker_id` | `string` | 是 | 执行 Worker |
| `fencing_token` | `integer` | 是 | 执行时 Lease token |
| `execution_status` | `string` | 是 | `SUCCEEDED`、`FAILED` 或 `UNKNOWN` |
| `started_at` | `timestamp` | 是 | 开始时间 |
| `ended_at` | `timestamp` | 是 | 结束或失联判定时间 |
| `request_ref` | `string` | 是 | 实际请求引用 |
| `request_hash` | `string` | 是 | 实际请求哈希 |
| `response_ref` | `string|null` | 是 | 可空响应引用 |
| `response_hash` | `string|null` | 是 | 可空响应哈希 |
| `external_receipt` | `object|null` | 是 | 外部标识及命名空间 |
| `evidence_refs` | `array<uuid>` | 是 | 执行证据 |
| `error` | `object|null` | 是 | 错误分类、代码、可重试性和安全摘要 |
| `result_summary` | `object` | 是 | 工具类型化结果 |
| `trace_id` | `uuid` | 是 | 跨层追踪标识 |
| `integrity` | `object` | 是 | 结果哈希和签发 Adapter |

## 3. 错误结构

```yaml
class: AMBIGUOUS
code: RESPONSE_LOST
retry_disposition: VERIFY_BEFORE_RETRY
summary: 请求可能已由外部系统处理，但响应未返回。
```

`class` 只能为 `TRANSIENT`、`PERMANENT`、`AMBIGUOUS` 或 `POLICY_BLOCKED`。

## 4. 不可变量

1. 标识、Worker 和 fencing token 必须与 Action Command 一致。
2. 超时、连接中断、进程崩溃或响应丢失且可能产生副作用时必须返回 `UNKNOWN`。
3. `execution_status=SUCCEEDED` 不能附带 `effect_confirmed=true` 一类越权字段。
4. 原始请求和响应在持久化前完成 Secret 隔离和脱敏。
5. 同一 Attempt 的终结结果只接受一次；冲突结果进入隔离和人工或对账处理。
6. Result Handler 校验结构后映射到 `execution.action_attempt`，再触发验证流程。

## 5. 持久化映射

字段持久化到 [`execution.action_attempt`](action-attempt.md)。外部回执和不可变对象登记到 `ingestion.evidence_index`。Action 状态只能由 Action Service 根据结果和后续验证更新。
