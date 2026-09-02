# LiveWorldStateInput

## 1. 定义

`LiveWorldStateInput` 是 Context Builder 从 `cognition.live_world_state` 生成并传入模型的只读、有界实时状态投影。它不是数据库行的直接序列化，也不是新的权威状态。

该结构必须让模型明确知道以下信息：

- 当前传入了哪些状态。
- 每项状态对应哪个精确版本。
- 状态值在什么时间范围内有效。
- 状态是否新鲜、过期或已撤回。
- 状态的置信度和计算来源。
- 哪些状态因预算、权限或不可用而没有传入。

## 2. 顶层结构

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `schema_version` | `integer` | 是 | 初始为 `1` |
| `input_type` | `string` | 是 | 固定为 `live_world_state_input` |
| `generated_at` | `timestamp` | 是 | Context Builder 完成投影的时间 |
| `as_of` | `timestamp` | 是 | 所有纳入状态共同的数据水位 |
| `subject` | `object` | 是 | `entity_id`、`entity_type`、`display_label` |
| `selection` | `object` | 是 | 选择策略、触发范围、预算和遗漏统计 |
| `states` | `array<StateItem>` | 是 | 排序后的实时状态项，允许空数组 |
| `coverage` | `object` | 是 | 完整性声明和未覆盖原因 |
| `integrity` | `object` | 是 | 投影哈希和来源快照标识 |

## 3. StateItem

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `state_id` | `uuid` | 是 | `live_world_state.state_id` 精确版本 |
| `state_version` | `integer` | 是 | 同一状态键的单调版本 |
| `state_key` | `string` | 是 | 版本化状态键 |
| `value` | `TypedValue` | 是 | 带类型标识的状态值 |
| `status` | `string` | 是 | `CURRENT`、`STALE` 或 `RETRACTED` |
| `confidence` | `number` | 是 | `[0,1]` |
| `validity` | `object` | 是 | `valid_from`、可空 `valid_to` |
| `freshness` | `object` | 是 | `as_of`、可空 `stale_after`、`age_ms`、`classification` |
| `provenance` | `object` | 是 | Observation、Derived Feature、Evidence 和 Estimator 引用 |
| `selection_reason` | `string` | 是 | 受控原因码，不使用自由叙事代替策略 |
| `relevance_score` | `number` | 是 | `[0,1]`，只用于本次上下文排序 |

`freshness.classification` 只能为：

- `FRESH`：`generated_at <= stale_after`，或状态键明确不设置过期时间。
- `STALE`：超过 `stale_after`，仍因任务需要被显式传入。
- `UNKNOWN`：缺少足够时间信息，模型不得把该项当作当前事实。

## 4. TypedValue

`TypedValue` 使用显式类型区分器，禁止让模型依赖 JSON 形状猜测语义。

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `type` | `string` | 是 | `STRING`、`NUMBER`、`BOOLEAN`、`TIMESTAMP`、`ENTITY_REF`、`GEO_POINT` 或 `OBJECT` |
| `data` | 对应类型 | 是 | 与 `type` 严格匹配 |
| `unit` | `string` | 否 | 数值单位；优先采用 UCUM |
| `schema_id` | `string` | 是 | 值语义的稳定 Schema 标识 |
| `schema_version` | `integer` | 是 | 值 Schema 版本 |

`ENTITY_REF` 的 `data` 必须只包含 `entity_id`、`entity_type` 和安全显示名。它不得嵌入实体的全部属性。

## 5. selection 与 coverage

`selection` 至少包含：

| 字段 | 类型 | 语义 |
|---|---|---|
| `policy_version` | `string` | 选择、排序和截断策略版本 |
| `trigger_type` | `string` | 本次调用触发类型 |
| `trigger_ref` | `uuid` | 触发记录标识 |
| `requested_keys` | `array<string>` | 调用方明确请求的状态键；无明确请求时为空 |
| `max_items` | `integer` | 状态项上限 |
| `included_count` | `integer` | 实际纳入数量 |
| `omitted_count` | `integer` | 已知但未纳入数量 |

`coverage` 至少包含：

| 字段 | 类型 | 语义 |
|---|---|---|
| `completeness` | `string` | `COMPLETE_FOR_REQUESTED_KEYS` 或 `PARTIAL` |
| `omission_reasons` | `array<string>` | `BUDGET`、`NOT_RELEVANT`、`ACCESS_DENIED`、`STALE_EXCLUDED`、`UNAVAILABLE` |
| `missing_requested_keys` | `array<string>` | 请求但没有可用值的状态键 |

模型必须把 `omitted_count > 0` 或 `completeness=PARTIAL` 理解为未传入不等于不存在。

## 6. provenance

每个 StateItem 的 `provenance` 至少包含：

```yaml
observation_ids: []
feature_ids: []
evidence_refs: []
estimator:
  id: project-state-estimator
  version: 1.0.0
```

模型上下文只传入标识和安全摘要。原始证据仅在工具按权限读取后进入单独上下文，不能由模型根据引用自动展开。

## 7. 不可变量

1. `states` 中同一 `state_key` 最多出现一个 `CURRENT` 版本。
2. `state_id`、`state_version`、`value`、`validity` 和 `provenance` 必须来自同一数据库版本。
3. `STALE` 或 `UNKNOWN` 项不得省略新鲜度分类。
4. Context Builder 不得在投影过程中改写状态值或提高置信度。
5. 选择分数不属于世界状态，不得回写 `live_world_state`。
6. Secret、凭据、Cookie、令牌和未脱敏原始载荷不得进入该结构。
7. 整个结构必须规范化序列化后计算 `integrity.payload_hash`。

## 8. 完整示例

```yaml
schema_version: 1
input_type: live_world_state_input
generated_at: 2026-09-02T05:20:00Z
as_of: 2026-09-02T05:19:58Z
subject:
  entity_id: 0199a100-0000-7000-8000-000000000001
  entity_type: PERSON
  display_label: Master
selection:
  policy_version: live-state-selection/v1
  trigger_type: INTERACTION
  trigger_ref: 0199aa00-0000-7000-8000-000000000001
  requested_keys:
    - activity.current_project
    - device.mac.status
  max_items: 16
  included_count: 2
  omitted_count: 1
states:
  - state_id: 0199a810-0000-7000-8000-000000000001
    state_version: 4
    state_key: activity.current_project
    value:
      type: ENTITY_REF
      data:
        entity_id: 0199a100-0000-7000-8000-000000000010
        entity_type: PROJECT
        display_label: Secretary
      schema_id: entity-reference
      schema_version: 1
    status: CURRENT
    confidence: 0.99
    validity:
      valid_from: 2026-09-02T04:18:12Z
      valid_to: null
    freshness:
      as_of: 2026-09-02T05:19:58Z
      stale_after: 2026-09-02T06:18:12Z
      age_ms: 3706000
      classification: FRESH
    provenance:
      observation_ids:
        - 0199a6f1-0170-7000-8000-000000000001
      feature_ids: []
      evidence_refs:
        - 0199a710-0000-7000-8000-000000000001
      estimator:
        id: project-state-estimator
        version: 1.0.0
    selection_reason: DIRECT_TRIGGER_RELEVANCE
    relevance_score: 1.0
  - state_id: 0199a811-0000-7000-8000-000000000001
    state_version: 8
    state_key: device.mac.status
    value:
      type: STRING
      data: ONLINE
      schema_id: device-status
      schema_version: 1
    status: STALE
    confidence: 0.84
    validity:
      valid_from: 2026-09-02T05:00:00Z
      valid_to: null
    freshness:
      as_of: 2026-09-02T05:19:58Z
      stale_after: 2026-09-02T05:10:00Z
      age_ms: 1198000
      classification: STALE
    provenance:
      observation_ids:
        - 0199a6f2-0000-7000-8000-000000000001
      feature_ids: []
      evidence_refs: []
      estimator:
        id: device-state-estimator
        version: 1.0.0
    selection_reason: REQUESTED_KEY
    relevance_score: 0.92
coverage:
  completeness: PARTIAL
  omission_reasons:
    - BUDGET
  missing_requested_keys: []
integrity:
  snapshot_id: 0199a860-0000-7000-8000-000000000001
  hash_algorithm: sha256
  payload_hash: a19c...
```
