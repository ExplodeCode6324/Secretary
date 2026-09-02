# cognition.world_model_fact

## 1. 定义

`world_model_fact` 保存 World Model Updater 已准入的稳定事实、关系、偏好和长期规律。它是 Secretary 长期认知的权威状态，但仍必须保留有效期、置信度、冲突状态和证据链。

权威写入者为 World Model Updater。LLM、Executor 和普通 Worker 不得直接写入。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `fact_id` | `uuid` | 是 | 事实版本主键 |
| `subject_entity_id` | `uuid` | 是 | 主体实体 |
| `predicate` | `text` | 是 | 版本化谓词 |
| `object_kind` | `text` | 是 | `ENTITY` 或 `VALUE` |
| `object_entity_id` | `uuid` | 否 | 关系对象实体 |
| `object_value` | `jsonb` | 否 | 标量或结构化事实值 |
| `value_schema_version` | `integer` | 是 | 事实值 Schema 版本 |
| `fact_class` | `text` | 是 | `STABLE_FACT`、`RELATION`、`PREFERENCE` 或 `PATTERN` |
| `status` | `text` | 是 | `ACTIVE`、`CONTESTED`、`SUPERSEDED`、`RETRACTED` 或 `EXPIRED` |
| `confidence` | `numeric(5,4)` | 是 | `[0,1]`，长期事实支持强度 |
| `valid_from` | `timestamptz` | 否 | 业务有效期起点 |
| `valid_to` | `timestamptz` | 否 | 业务有效期终点 |
| `assertion_ids` | `uuid[]` | 是 | 支持该版本的 Assertion 集合 |
| `evidence_refs` | `uuid[]` | 是 | 关键证据引用 |
| `conflict_set_id` | `uuid` | 否 | 冲突事实集合 |
| `admission_rule_version` | `text` | 是 | World Model 准入规则版本 |
| `supersedes_fact_id` | `uuid` | 否 | 被该版本取代的事实 |
| `version` | `bigint` | 是 | 同一逻辑事实的单调版本 |
| `admitted_at` | `timestamptz` | 是 | 准入时间 |
| `updated_at` | `timestamptz` | 是 | 状态最近更新时间 |

## 3. 不可变量

1. `object_kind` 与对象字段必须严格匹配。
2. 每个事实版本必须至少关联一条 Assertion；Master 直接录入也必须先形成可追溯 Assertion。
3. 新事实不得静默覆盖冲突事实。冲突项必须并存并标记 `CONTESTED` 或形成显式版本关系。
4. `ACTIVE` 不表示永恒正确。查询和模型输入必须携带有效期、置信度和冲突状态。
5. LLM 输出不能单独满足准入条件。
6. 事实内容、准入规则版本和证据集合不得原位重写；变化生成新版本。

## 4. 关系与索引

- 主体与对象实体引用 `cognition.entity`。
- `assertion_ids[] -> cognition.assertion.assertion_id`。
- `evidence_refs[] -> ingestion.evidence_index.evidence_id`。
- 相关事实查询索引：`(subject_entity_id, predicate, status, valid_from desc)`。
- 关系反向查询索引：`object_entity_id`。
- 冲突查询索引：`conflict_set_id`。

## 5. 模型输入边界

本表不能作为未经筛选的提示词内容。Context Builder 必须通过 [`WorldModelInput`](../context/world-model-input.md) 传入相关事实切片，并保留冲突、有效期、置信度和溯源信息。

## 6. 示例

```yaml
fact_id: 0199a820-0000-7000-8000-000000000001
subject_entity_id: 0199a100-0000-7000-8000-000000000010
predicate: project.repository_url
object_kind: VALUE
object_value:
  url: https://github.com/ExplodeCode6324/Secretary
value_schema_version: 1
fact_class: STABLE_FACT
status: ACTIVE
confidence: 1.0
assertion_ids:
  - 0199a800-0000-7000-8000-000000000001
evidence_refs:
  - 0199a710-0000-7000-8000-000000000001
admission_rule_version: world-model-v1
version: 1
admitted_at: 2026-09-02T04:22:00Z
updated_at: 2026-09-02T04:22:00Z
```
