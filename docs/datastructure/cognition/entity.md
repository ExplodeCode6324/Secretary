# cognition.entity

## 1. 定义

`entity` 保存 Secretary 可引用的人、组织、设备、项目、账户、资源、地点和沟通渠道的稳定逻辑身份。它解决跨来源同一对象的身份归并，不保存凭据，也不直接保存随时间变化的状态。

权威写入者为 Entity Service。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `entity_id` | `uuid` | 是 | 主键 |
| `entity_type` | `text` | 是 | `PERSON`、`ORGANIZATION`、`DEVICE`、`PROJECT`、`ACCOUNT`、`RESOURCE`、`PLACE` 或 `CHANNEL` |
| `canonical_name` | `text` | 是 | 当前规范显示名，不承担唯一识别责任 |
| `aliases` | `text[]` | 是 | 已知别名，默认空数组 |
| `external_keys` | `jsonb` | 是 | 来源命名空间到外部稳定标识的映射 |
| `attributes` | `jsonb` | 是 | 低变化、非敏感目录属性；事实语义仍进入 Assertion 或 World Model Fact |
| `status` | `text` | 是 | `ACTIVE`、`MERGED` 或 `RETIRED` |
| `merged_into_entity_id` | `uuid` | 否 | `MERGED` 状态下的规范实体 |
| `version` | `bigint` | 是 | 乐观并发版本 |
| `created_at` | `timestamptz` | 是 | 创建时间 |
| `updated_at` | `timestamptz` | 是 | 最近更新时间 |

## 3. 不可变量

1. `status=MERGED` 时必须填写 `merged_into_entity_id`，且不得指向自身。
2. 实体归并不删除旧标识。所有历史引用继续可解析到规范实体。
3. `external_keys` 的键必须带来源命名空间，值不得为登录凭据或访问令牌。
4. 当前状态、偏好、关系和长期规律不得隐藏在自由格式 `attributes` 中。
5. 同一来源稳定标识最多绑定一个 `ACTIVE` 规范实体。

## 4. 关系与索引

- 被 Observation、Assertion、World Model Fact、Goal、Task 等结构引用。
- 外部标识需要规范化辅助表或等价的 GIN/表达式唯一约束。
- 查询索引：`(entity_type, status, canonical_name)`。
- 合并索引：`merged_into_entity_id`。

## 5. 示例

```yaml
entity_id: 0199a100-0000-7000-8000-000000000010
entity_type: PROJECT
canonical_name: Secretary
aliases:
  - ExplodeCode6324/Secretary
external_keys:
  github_repository: ExplodeCode6324/Secretary
attributes:
  visibility: public
status: ACTIVE
version: 1
created_at: 2026-09-02T04:00:00Z
updated_at: 2026-09-02T04:00:00Z
```
