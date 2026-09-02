# execution.task_step

## 1. 定义

`task_step` 保存任务当前执行计划中的最小可推进步骤、依赖关系、输入、预期输出和步骤状态。步骤可以被重新规划，但已发生的执行历史必须保留。

权威写入者为 Task Service。Task-Step LLM 只能提出步骤变更建议。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `step_id` | `uuid` | 是 | 主键 |
| `task_id` | `uuid` | 是 | 所属任务 |
| `step_key` | `text` | 是 | 任务内稳定幂等标识 |
| `parent_step_id` | `uuid` | 否 | 层级父步骤 |
| `sequence_no` | `integer` | 否 | 展示顺序，不作为唯一依赖依据 |
| `step_kind` | `text` | 是 | 版本化步骤类型 |
| `objective` | `text` | 是 | 当前步骤目标 |
| `dependency_step_ids` | `uuid[]` | 是 | 必须满足的前置步骤 |
| `input_refs` | `jsonb` | 是 | 精确版本的输入、状态和产物引用 |
| `expected_outputs` | `jsonb` | 是 | 可验证输出定义 |
| `status` | `text` | 是 | 步骤状态，见下文 |
| `attempt_count` | `integer` | 是 | 非负执行轮次计数 |
| `next_wakeup_at` | `timestamptz` | 否 | 时间唤醒点 |
| `wakeup_condition` | `jsonb` | 否 | 事件唤醒条件 |
| `latest_result_ref` | `text` | 否 | 最新结果或 Artifact 引用 |
| `version` | `bigint` | 是 | 乐观并发版本 |
| `created_at` | `timestamptz` | 是 | 创建时间 |
| `updated_at` | `timestamptz` | 是 | 最近更新时间 |

V1 建议步骤状态：`PLANNED`、`READY`、`RUNNING`、`WAITING`、`SUCCEEDED`、`FAILED`、`CANCELLED`、`SKIPPED`、`SUPERSEDED`。

## 3. 不可变量

1. `(task_id, step_key)` 唯一。
2. 步骤只有在所有依赖进入允许的完成状态后才能转为 `READY`。
3. 形成外部副作用的工作必须通过独立 Action，不得仅以 `task_step.status=SUCCEEDED` 代表效果成立。
4. 重规划不得删除已执行步骤；旧步骤转为 `SUPERSEDED` 并保留结果引用。
5. `input_refs` 必须固定版本，不能使用会漂移的 latest 引用。
6. `SUCCEEDED` 必须满足 `expected_outputs` 的验证条件。

## 4. 关系与索引

- `task_id -> execution.task.task_id`。
- 步骤依赖引用同一任务的 Task Step。
- 被 Action、Artifact 和 Worker Lease 引用。
- 唯一索引：`(task_id, step_key)`。
- 调度索引：`(status, next_wakeup_at)`。
- 任务展示索引：`(task_id, sequence_no, created_at)`。

## 5. 示例

```yaml
step_id: 0199a910-0000-7000-8000-000000000001
task_id: 0199a900-0000-7000-8000-000000000001
step_key: design-context-input-contracts
sequence_no: 3
step_kind: document.design
objective: 定义传入模型的 World Model 和 Live World State 结构化数据
dependency_step_ids: []
input_refs:
  design_document:
    ref: docs/Design.md
    hash: sha256:0b9e...
expected_outputs:
  documents:
    - docs/datastructure/context/live-world-state-input.md
    - docs/datastructure/context/world-model-input.md
status: RUNNING
attempt_count: 1
version: 2
created_at: 2026-09-02T05:10:00Z
updated_at: 2026-09-02T05:20:00Z
```
