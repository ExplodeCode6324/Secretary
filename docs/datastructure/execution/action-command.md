# ActionCommand

## 1. 定义

`ActionCommand` 是 Action Service 和 Dispatcher 生成、可交给 Executor Adapter 的最小原子执行指令。它是 `execution.action` 某个精确版本在一次 Worker Lease 下的传输结构。

Action Command 只能由权威服务生成，不能直接采用模型输出。

## 2. 字段

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `schema_version` | `integer` | 是 | 初始为 `1` |
| `command_id` | `uuid` | 是 | 本次下发命令标识 |
| `action_id` | `uuid` | 是 | Action 标识 |
| `action_version` | `integer` | 是 | 精确 Action 版本 |
| `attempt_id` | `uuid` | 是 | 预创建 Action Attempt 标识 |
| `task_id` | `uuid` | 是 | 所属任务 |
| `step_id` | `uuid` | 是 | 所属步骤 |
| `tool` | `string` | 是 | 目标 Adapter |
| `operation` | `string` | 是 | 原子操作 |
| `arguments_ref` | `string` | 是 | 不可变参数引用 |
| `arguments_hash` | `string` | 是 | 规范化参数哈希 |
| `preconditions` | `array<object>` | 是 | 必须在执行前检查的条件 |
| `expected_effect` | `object` | 是 | 后续验证目标 |
| `verification_plan` | `object` | 是 | 后续验证计划 |
| `risk_class` | `string` | 是 | Policy Gate 确认的最终风险 |
| `approval_proof` | `object|null` | 是 | Approval ID、版本和范围摘要 |
| `idempotency_key` | `string` | 是 | Executor 和外部系统使用的稳定键 |
| `lease` | `object` | 是 | Lease ID、Worker ID、fencing token 和到期时间 |
| `credential_handle` | `string|null` | 是 | 最小权限、短时凭据句柄；不得持久化解析值 |
| `deadline_at` | `timestamp` | 是 | 命令失效时间 |
| `trace_id` | `uuid` | 是 | 跨层追踪标识 |
| `integrity` | `object` | 是 | 命令哈希和签发者 |

## 3. 不可变量

1. `action_version`、Approval 版本和 Lease fencing token 必须在下发时仍有效。
2. `(action_id, attempt_id, idempotency_key)` 在一次命令语义内固定。
3. Executor 必须先验证命令完整性、截止时间、Lease 和前置条件，再产生副作用。
4. 前置条件失败返回安全失败结果，不得自行修改参数继续执行。
5. `credential_handle` 只能在安全边界内解析，并受命令资源范围和截止时间限制。
6. 命令重投必须保持相同语义和幂等键；语义变化生成新 Action。
7. Executor 成功返回不等于外部效果确认。

## 4. 示例

```yaml
schema_version: 1
command_id: 0199a921-0000-7000-8000-000000000001
action_id: 0199a920-0000-7000-8000-000000000001
action_version: 1
attempt_id: 0199a930-0000-7000-8000-000000000001
task_id: 0199a900-0000-7000-8000-000000000001
step_id: 0199a910-0000-7000-8000-000000000001
tool: workspace.patch
operation: create_document
arguments_ref: object://actions/0199a920/arguments.yaml
arguments_hash: sha256:35a1...
preconditions: []
expected_effect:
  type: FILE_PRESENT_WITH_HASH
verification_plan:
  methods:
    - INDEPENDENT_READBACK
risk_class: REVERSIBLE
approval_proof: null
idempotency_key: secretary:datastructure:world-model-input:v1
lease:
  lease_id: 0199a980-0000-7000-8000-000000000001
  worker_id: workspace-worker-2
  fencing_token: 12
  expires_at: 2026-09-02T05:20:30Z
credential_handle: null
deadline_at: 2026-09-02T05:20:30Z
trace_id: 0199a930-0000-7000-8000-000000000099
integrity:
  issued_by: action-dispatcher/v1
  payload_hash: sha256:c3d0...
```
