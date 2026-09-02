# cognition.assertion

## 1. 定义

`assertion` 保存由 Observation、人工录入或受控推断生成的候选事实。Assertion 可被比较、支持、反驳、失效或晋升，但自身不等于 Secretary 已接受的长期事实。

权威写入者为 Assertion Service。LLM 输出只能作为带完整溯源的候选输入，由该服务校验后登记。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `assertion_id` | `uuid` | 是 | 主键 |
| `subject_entity_id` | `uuid` | 是 | 主体实体 |
| `predicate` | `text` | 是 | 版本化谓词，例如 `project.repository_url` |
| `object_kind` | `text` | 是 | `ENTITY` 或 `VALUE` |
| `object_entity_id` | `uuid` | 否 | 对象为实体时填写 |
| `object_value` | `jsonb` | 否 | 对象为标量或结构化值时填写 |
| `value_schema_version` | `integer` | 是 | 对象值 Schema 版本 |
| `status` | `text` | 是 | `CANDIDATE`、`SUPPORTED`、`CONTESTED`、`REJECTED`、`SUPERSEDED` 或 `EXPIRED` |
| `confidence` | `numeric(5,4)` | 是 | `[0,1]`，表示候选支持强度，不代表准入 |
| `valid_from` | `timestamptz` | 否 | 候选事实业务有效期起点 |
| `valid_to` | `timestamptz` | 否 | 业务有效期终点 |
| `source_observation_ids` | `uuid[]` | 是 | 直接来源 Observation 集合 |
| `evidence_refs` | `uuid[]` | 是 | 证据集合 |
| `derived_by` | `text` | 是 | 人工、规则、Processor 或模型辅助组件标识 |
| `model_decision_id` | `uuid` | 否 | 模型参与抽取时关联 Decision Record |
| `conflict_set_id` | `uuid` | 否 | 互斥或竞争候选的集合标识 |
| `supersedes_assertion_id` | `uuid` | 否 | 显式版本关系 |
| `created_at` | `timestamptz` | 是 | 创建时间 |

## 3. 不可变量

1. `object_kind=ENTITY` 时只填写 `object_entity_id`；`object_kind=VALUE` 时只填写 `object_value`。
2. Assertion 为追加式记录。状态判定可通过受控服务更新，但原始命题、来源和证据不得修改。
3. 无 Observation、无证据且非 Master 明确录入的候选不得晋升为 `SUPPORTED`。
4. 冲突候选必须并存并共享 `conflict_set_id`，不得静默覆盖。
5. LLM 生成的高置信度数值不能绕过 World Model Updater 的准入。
6. `valid_to` 非空时必须晚于 `valid_from`。

## 4. 关系与索引

- 主体与对象实体引用 `cognition.entity`。
- 来源引用 `ingestion.observation` 和 `ingestion.evidence_index`。
- `model_decision_id -> interaction.decision_record.decision_id`。
- 命题检索索引：`(subject_entity_id, predicate, status, valid_from desc)`。
- 冲突检索索引：`conflict_set_id`。
- 去重建议基于规范化命题哈希、来源集合和有效区间。

## 5. 示例

```yaml
assertion_id: 0199a800-0000-7000-8000-000000000001
subject_entity_id: 0199a100-0000-7000-8000-000000000010
predicate: project.repository_url
object_kind: VALUE
object_value:
  url: https://github.com/ExplodeCode6324/Secretary
value_schema_version: 1
status: SUPPORTED
confidence: 1.0
source_observation_ids:
  - 0199a6f1-0170-7000-8000-000000000001
evidence_refs:
  - 0199a710-0000-7000-8000-000000000001
derived_by: project-processor/v1
created_at: 2026-09-02T04:21:00Z
```
