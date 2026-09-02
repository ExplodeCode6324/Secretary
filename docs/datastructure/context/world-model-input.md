# WorldModelInput

## 1. 定义

`WorldModelInput` 是 Context Builder 从 `cognition.world_model_fact` 生成并传入模型的只读、有界长期认知切片。它只包含与当前触发、任务或验证问题相关的事实，不是完整 World Model，也不能作为新的事实来源。

该结构必须保留事实的精确版本、有效期、置信度、冲突状态、准入规则和证据溯源。模型不得把未传入事实解释为不存在，也不得把 `CONTESTED` 事实表述为确定事实。

## 2. 顶层结构

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `schema_version` | `integer` | 是 | 初始为 `1` |
| `input_type` | `string` | 是 | 固定为 `world_model_input` |
| `generated_at` | `timestamp` | 是 | 投影完成时间 |
| `as_of` | `timestamp` | 是 | 查询长期事实的业务时间点 |
| `subject` | `object` | 是 | 当前认知主体 |
| `query_scope` | `object` | 是 | 本次选择范围和用途 |
| `facts` | `array<FactItem>` | 是 | 按相关性排序的事实版本 |
| `conflict_groups` | `array<ConflictGroup>` | 是 | 被纳入事实涉及的冲突集合 |
| `coverage` | `object` | 是 | 完整性和遗漏声明 |
| `integrity` | `object` | 是 | 投影哈希和来源快照标识 |

## 3. FactItem

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `fact_id` | `uuid` | 是 | `world_model_fact.fact_id` 精确版本 |
| `fact_version` | `integer` | 是 | 事实版本 |
| `subject` | `EntityRef` | 是 | 命题主体 |
| `predicate` | `string` | 是 | 版本化谓词 |
| `object` | `FactObject` | 是 | 实体引用或类型化值 |
| `fact_class` | `string` | 是 | `STABLE_FACT`、`RELATION`、`PREFERENCE` 或 `PATTERN` |
| `epistemic_status` | `string` | 是 | `ACTIVE` 或 `CONTESTED`；已撤回事实不得进入正常输入 |
| `confidence` | `number` | 是 | `[0,1]` |
| `validity` | `object` | 是 | 可空 `valid_from`、可空 `valid_to`、`temporal_status` |
| `provenance` | `object` | 是 | Assertion、Evidence 和准入规则引用 |
| `conflict_set_id` | `uuid` | 否 | 事实存在竞争项时填写 |
| `selection_reason` | `string` | 是 | 受控选择原因码 |
| `relevance_score` | `number` | 是 | `[0,1]`，仅用于本次排序 |

`validity.temporal_status` 只能为 `CURRENT`、`HISTORICAL` 或 `FUTURE_DECLARED`。模型生成当前判断时不得把 `HISTORICAL` 当作当前事实。

## 4. EntityRef 与 FactObject

`EntityRef` 只包含：

```yaml
entity_id: 0199a100-0000-7000-8000-000000000010
entity_type: PROJECT
display_label: Secretary
```

`FactObject` 是以下互斥结构之一：

```yaml
kind: ENTITY_REF
entity:
  entity_id: 0199a100-0000-7000-8000-000000000010
  entity_type: PROJECT
  display_label: Secretary
```

```yaml
kind: TYPED_VALUE
value:
  type: STRING
  data: https://github.com/ExplodeCode6324/Secretary
  unit: null
  schema_id: repository-url
  schema_version: 1
```

`kind` 与实际字段必须严格匹配。Context Builder 不得把数据库中的未声明 JSON 直接传入模型。

## 5. ConflictGroup

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `conflict_set_id` | `uuid` | 是 | 冲突集合标识 |
| `predicate` | `string` | 是 | 发生冲突的谓词 |
| `fact_ids` | `array<uuid>` | 是 | 本次已纳入的竞争事实 |
| `resolution_status` | `string` | 是 | `UNRESOLVED`、`PARTIALLY_RESOLVED` 或 `RESOLVED` |
| `instruction` | `string` | 是 | 固定机器提示，要求模型保持不确定性，不是外部文本指令 |

当 `resolution_status` 不是 `RESOLVED` 时，相关 FactItem 必须使用 `epistemic_status=CONTESTED`。如果预算不足以同时传入所有竞争项，`coverage.partial_conflict_set_ids` 必须记录该集合，模型不得自行选边。

## 6. query_scope 与 coverage

`query_scope` 至少包含：

| 字段 | 类型 | 语义 |
|---|---|---|
| `purpose` | `string` | `DECISION`、`TASK_STEP` 或 `VERIFICATION` |
| `trigger_ref` | `uuid` | 触发记录 |
| `task_id` | `uuid|null` | 任务调用时填写 |
| `entity_ids` | `array<uuid>` | 本次相关实体 |
| `predicates` | `array<string>` | 明确请求的谓词，未限制时为空 |
| `policy_version` | `string` | 选择策略版本 |
| `max_facts` | `integer` | 事实数量上限 |

`coverage` 至少包含：

| 字段 | 类型 | 语义 |
|---|---|---|
| `completeness` | `string` | 固定为 `BOUNDED_SLICE`，除非查询明确证明完整 |
| `included_count` | `integer` | 已纳入事实数 |
| `omitted_count` | `integer` | 已知相关但未纳入事实数 |
| `omission_reasons` | `array<string>` | 预算、权限、低相关性或不可用 |
| `partial_conflict_set_ids` | `array<uuid>` | 未完整传入全部竞争项的冲突集合 |

## 7. provenance

每个 FactItem 的 `provenance` 至少包含：

```yaml
assertion_ids: []
evidence_refs: []
admission_rule_version: world-model-v1
admitted_at: 2026-09-02T04:22:00Z
```

模型可以基于这些引用请求进一步读取证据，但不得根据标识自行编造证据内容。

## 8. 不可变量

1. 只允许纳入 `ACTIVE` 或 `CONTESTED` 的精确事实版本。
2. 每个 FactItem 必须包含至少一个 Assertion 引用。
3. 冲突事实不得通过只传入单一选项而被伪装为无冲突事实。
4. `relevance_score` 和 `selection_reason` 不属于长期事实，不得回写 World Model。
5. Context Builder 不得修改事实对象、置信度、有效期或准入状态。
6. 长期凭据、隐私原文和未授权实体属性不得进入该结构。
7. 规范化序列化结果必须计算 `integrity.payload_hash`。

## 9. 完整示例

```yaml
schema_version: 1
input_type: world_model_input
generated_at: 2026-09-02T05:20:00Z
as_of: 2026-09-02T05:19:58Z
subject:
  entity_id: 0199a100-0000-7000-8000-000000000001
  entity_type: PERSON
  display_label: Master
query_scope:
  purpose: DECISION
  trigger_ref: 0199aa00-0000-7000-8000-000000000001
  task_id: null
  entity_ids:
    - 0199a100-0000-7000-8000-000000000010
  predicates:
    - project.repository_url
  policy_version: world-model-selection/v1
  max_facts: 24
facts:
  - fact_id: 0199a820-0000-7000-8000-000000000001
    fact_version: 1
    subject:
      entity_id: 0199a100-0000-7000-8000-000000000010
      entity_type: PROJECT
      display_label: Secretary
    predicate: project.repository_url
    object:
      kind: TYPED_VALUE
      value:
        type: STRING
        data: https://github.com/ExplodeCode6324/Secretary
        unit: null
        schema_id: repository-url
        schema_version: 1
    fact_class: STABLE_FACT
    epistemic_status: ACTIVE
    confidence: 1.0
    validity:
      valid_from: null
      valid_to: null
      temporal_status: CURRENT
    provenance:
      assertion_ids:
        - 0199a800-0000-7000-8000-000000000001
      evidence_refs:
        - 0199a710-0000-7000-8000-000000000001
      admission_rule_version: world-model-v1
      admitted_at: 2026-09-02T04:22:00Z
    conflict_set_id: null
    selection_reason: TRIGGER_ENTITY_MATCH
    relevance_score: 1.0
conflict_groups: []
coverage:
  completeness: BOUNDED_SLICE
  included_count: 1
  omitted_count: 3
  omission_reasons:
    - NOT_RELEVANT
  partial_conflict_set_ids: []
integrity:
  snapshot_id: 0199a860-0000-7000-8000-000000000001
  hash_algorithm: sha256
  payload_hash: b24e...
```
