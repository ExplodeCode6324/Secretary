# cognition.episodic_memory

## 1. 定义

`episodic_memory` 保存经显著性准入的重要事件和阶段性经历摘要，用于未来相关场景的背景检索。它是由 Observation 和任务历史派生的记忆结构，不具备独立事实权威。

权威写入者为 Episodic Memory Projector。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `episode_id` | `uuid` | 是 | 主键 |
| `subject_entity_id` | `uuid` | 是 | 经历主体 |
| `title` | `text` | 是 | 简短事实性标题 |
| `summary` | `text` | 是 | 有界摘要，不替代原始记录 |
| `episode_start` | `timestamptz` | 是 | 经历开始时间 |
| `episode_end` | `timestamptz` | 否 | 经历结束时间 |
| `salience_score` | `integer` | 是 | `0..100` |
| `status` | `text` | 是 | `CANDIDATE`、`ADMITTED`、`SUPERSEDED` 或 `RETIRED` |
| `observation_ids` | `uuid[]` | 是 | 来源 Observation |
| `task_ids` | `uuid[]` | 是 | 相关任务 |
| `evidence_refs` | `uuid[]` | 是 | 关键证据 |
| `entity_ids` | `uuid[]` | 是 | 相关实体 |
| `generated_by` | `text` | 是 | 投影器或受控人工录入来源 |
| `model_decision_id` | `uuid` | 否 | 模型辅助摘要的审计引用 |
| `summary_hash` | `text` | 是 | 规范化摘要哈希 |
| `version` | `bigint` | 是 | 版本 |
| `created_at` | `timestamptz` | 是 | 创建时间 |

## 3. 不可变量

1. `ADMITTED` 记录必须至少引用一个 Observation 或 Task。
2. 摘要不得引入来源中不存在的新事实；模型推断必须保持候选语义。
3. Episode 更新生成新版本或 `SUPERSEDED` 关系，不改写已用于历史模型调用的内容。
4. 向量和全文索引为可重建派生索引，不是 Episodic Memory 的权威副本。
5. Episodic Memory 晋升长期事实时必须生成 Assertion 并经过 World Model 准入流程。

## 4. 关系与索引

- 引用 Entity、Observation、Task、Evidence Index 和 Decision Record。
- 时间检索索引：`(subject_entity_id, episode_start desc)`。
- 显著性索引：`(subject_entity_id, status, salience_score desc)`。
- `summary_hash` 用于重复摘要检测。

## 5. 示例

```yaml
episode_id: 0199a850-0000-7000-8000-000000000001
subject_entity_id: 0199a100-0000-7000-8000-000000000001
title: Secretary 数据结构设计
summary: Master 明确要求单独定义传入模型的 World Model 和 Live World State 结构化投影。
episode_start: 2026-09-02T04:30:00Z
salience_score: 90
status: ADMITTED
observation_ids: []
task_ids:
  - 0199a900-0000-7000-8000-000000000001
evidence_refs: []
entity_ids:
  - 0199a100-0000-7000-8000-000000000010
generated_by: episodic-projector/v1
summary_hash: sha256:ef12...
version: 1
created_at: 2026-09-02T05:05:00Z
```
