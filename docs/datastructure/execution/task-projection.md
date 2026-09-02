# execution.task_projection

## 1. 定义

`task_projection` 把 Task、Task Step 和近期 Task Event 压缩为面向 Open Loop 与 Consciousness 的有界摘要。它用于注意力和汇报选择，不是任务权威存储。

权威写入者为 Task Projector。投影创建后不可修改；来源 Task 变化时生成新版本。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `projection_id` | `uuid` | 是 | 主键 |
| `task_id` | `uuid` | 是 | 来源任务 |
| `task_version` | `bigint` | 是 | 来源 Task 精确版本 |
| `task_status` | `text` | 是 | 投影时的任务状态 |
| `current_phase` | `text` | 否 | 当前阶段摘要 |
| `progress_summary` | `text` | 是 | 已完成和正在进行内容的有界摘要 |
| `blocking_reason` | `text` | 否 | 阻塞或等待原因 |
| `next_wakeup_at` | `timestamptz` | 否 | 时间唤醒点 |
| `next_wakeup_condition` | `jsonb` | 否 | 事件唤醒条件 |
| `recent_significant_change` | `text` | 否 | 最近需要注意的变化 |
| `completion_summary` | `text` | 否 | 仅在完成条件已验证后生成 |
| `salience_score` | `integer` | 是 | `0..100`，用于注意力排序 |
| `source_task_event_id` | `uuid` | 是 | 触发投影的最新事件 |
| `projection_hash` | `text` | 是 | 规范化投影哈希 |
| `projector_version` | `text` | 是 | 投影算法版本 |
| `projected_at` | `timestamptz` | 是 | 生成时间 |
| `expires_at` | `timestamptz` | 否 | 缓存失效时间 |

## 3. 不可变量

1. `(task_id, task_version, projector_version)` 唯一。
2. 投影不得声明来源 Task 中未成立的状态。
3. `completion_summary` 只有在 `task_status=COMPLETED` 且成功条件证据齐全时可填写。
4. 完整日志、原始文件和证据正文不得进入投影。
5. `salience_score` 只能影响注意力排序，不能改变 Task 优先级、风险或授权。
6. 投影失败不得阻止 Task 权威状态提交；系统应重试投影并暴露延迟。

## 4. 关系与索引

- `task_id -> execution.task.task_id`。
- `source_task_event_id -> execution.task_event.task_event_id`。
- 被 `cognition.open_loop` 和 `cognition.consciousness_snapshot` 使用。
- 唯一索引：`(task_id, task_version, projector_version)`。
- 最新投影索引：`(task_id, projected_at desc)`。
- 意识选择索引：`(task_status, salience_score desc, projected_at desc)`。

## 5. 示例

```yaml
projection_id: 0199a970-0000-7000-8000-000000000001
task_id: 0199a900-0000-7000-8000-000000000001
task_version: 6
task_status: RUNNING
current_phase: 结构化模型输入契约
progress_summary: 五个逻辑域的数据结构文档正在编写，已补充模型输入投影边界。
recent_significant_change: Master 指定 World Model 和 Live World State 输入结构为重点。
salience_score: 90
source_task_event_id: 0199a940-0000-7000-8000-000000000001
projection_hash: sha256:931a...
projector_version: task-projector/1.0.0
projected_at: 2026-09-02T05:21:00Z
```
