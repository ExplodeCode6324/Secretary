# execution.worker_lease

## 1. 定义

`worker_lease` 保存 Worker 对 Task Step 或 Action 的限时处理权、心跳和 fencing token。它用于故障恢复和防止过期 Worker 提交结果，不证明任务或动作已经成功。

权威写入者为 Orchestrator / Lease Service。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `lease_id` | `uuid` | 是 | 主键 |
| `resource_type` | `text` | 是 | `TASK_STEP` 或 `ACTION` |
| `resource_id` | `uuid` | 是 | 被租用资源 |
| `worker_id` | `text` | 是 | Worker 实例标识 |
| `fencing_token` | `bigint` | 是 | 每次重新分配严格递增 |
| `status` | `text` | 是 | `ACTIVE`、`RELEASED`、`EXPIRED` 或 `REVOKED` |
| `acquired_at` | `timestamptz` | 是 | 租约获取时间 |
| `last_heartbeat_at` | `timestamptz` | 是 | 最近心跳时间 |
| `expires_at` | `timestamptz` | 是 | 租约到期时间 |
| `released_at` | `timestamptz` | 否 | 正常释放时间 |
| `version` | `bigint` | 是 | 乐观并发版本 |
| `trace_id` | `uuid` | 是 | 跨层追踪标识 |

## 3. 不可变量

1. 同一资源最多有一个 `ACTIVE` 租约。
2. 同一资源的 `fencing_token` 每次分配严格递增，外部写入和结果提交必须验证 token。
3. 过期 Worker 的结果不能直接提交为权威状态。
4. 对可能产生副作用的 Action，租约过期必须先把结果视为未知并进入对账，不能直接重试。
5. 心跳只能延长当前有效租约，不能复活已 `EXPIRED` 或 `REVOKED` 租约。
6. 租约时间使用数据库或统一时间源判断，不能信任 Worker 本地时钟。

## 4. 关系与索引

- `resource_id` 按 `resource_type` 引用 Task Step 或 Action。
- 被 Action Attempt 引用。
- 活跃唯一索引：`(resource_type, resource_id)` 条件为 `status=ACTIVE`。
- 过期扫描索引：`(status, expires_at)`。
- Worker 查询索引：`(worker_id, status)`。

## 5. 示例

```yaml
lease_id: 0199a980-0000-7000-8000-000000000001
resource_type: ACTION
resource_id: 0199a920-0000-7000-8000-000000000001
worker_id: workspace-worker-2
fencing_token: 12
status: ACTIVE
acquired_at: 2026-09-02T05:19:55Z
last_heartbeat_at: 2026-09-02T05:20:00Z
expires_at: 2026-09-02T05:20:30Z
version: 2
trace_id: 0199a980-0000-7000-8000-000000000099
```
