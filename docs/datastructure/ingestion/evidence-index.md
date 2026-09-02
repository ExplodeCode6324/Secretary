# ingestion.evidence_index

## 1. 定义

`evidence_index` 是不可变证据对象和外部正式回执的权威元数据目录。它证明证据对象的来源、完整性、捕获时间和保留规则，但不自行解释证据是否足以满足成功条件。

权威写入者为 Executor、Sensor Adapter、Verifier 或受控 Evidence Service。模型生成文本不能登记为外部回执。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `evidence_id` | `uuid` | 是 | 主键 |
| `evidence_kind` | `text` | 是 | 证据类型，见枚举 |
| `storage_ref` | `text` | 否 | 不可变对象地址；纯外部标识证据可为空 |
| `content_hash` | `text` | 否 | 对象内容哈希，格式为 `algorithm:value` |
| `mime_type` | `text` | 否 | IANA MIME 类型 |
| `size_bytes` | `bigint` | 否 | 非负对象大小 |
| `source_system` | `text` | 是 | 证据产生系统 |
| `external_identifier` | `text` | 否 | message ID、Commit SHA、交易哈希、订单号等 |
| `captured_at` | `timestamptz` | 是 | 获取证据的时间 |
| `captured_by` | `text` | 是 | Adapter、Executor 或 Verifier 组件标识 |
| `subject_ref` | `text` | 否 | 证据所证明对象的受控引用 |
| `confidentiality` | `text` | 是 | `PUBLIC`、`INTERNAL`、`SENSITIVE` 或 `RESTRICTED` |
| `retention_class` | `text` | 是 | 保留策略标识 |
| `encryption_key_ref` | `text` | 否 | 密钥句柄；不得包含密钥材料 |
| `redaction_status` | `text` | 是 | `NOT_REQUIRED`、`REDACTED` 或 `RESTRICTED_RAW` |
| `metadata` | `jsonb` | 是 | 已声明 Schema 的证据元数据 |
| `created_at` | `timestamptz` | 是 | 索引记录创建时间 |

`evidence_kind` 初始集合：

- `EXTERNAL_RECEIPT`
- `INDEPENDENT_READBACK`
- `STATE_SNAPSHOT`
- `CONTENT_OBJECT`
- `UI_CAPTURE`
- `MODEL_ASSISTED_ANALYSIS`

## 3. 不可变量

1. 有 `storage_ref` 时必须同时保存 `content_hash`。
2. 对象一旦登记不得原位替换。内容变化必须创建新 `evidence_id`。
3. `MODEL_ASSISTED_ANALYSIS` 只能作为候选验证依据，不能伪装成 `EXTERNAL_RECEIPT`。
4. 外部唯一标识必须连同 `source_system` 解释，禁止脱离命名空间比较。
5. 证据引用不得指向可变文件路径而不带内容哈希或版本标识。
6. 证据对象不得包含长期凭据、未脱敏令牌或钱包私钥。

## 4. 关系与索引

- 被 `observation.evidence_refs`、`action_attempt.evidence_refs`、`artifact.evidence_refs` 等结构引用。
- 外部回执唯一索引建议为 `(source_system, evidence_kind, external_identifier)`，空值除外。
- 内容去重索引：`content_hash`。
- 保留扫描索引：`(retention_class, captured_at)`。

## 5. 示例

```yaml
evidence_id: 0199a710-0000-7000-8000-000000000001
evidence_kind: EXTERNAL_RECEIPT
source_system: github
external_identifier: 0c4cdf7e76b25c7cd7316844def3af8d7d3c6e5b
captured_at: 2026-09-02T04:20:00Z
captured_by: github-verifier/v1
subject_ref: repository:ExplodeCode6324/Secretary:refs/heads/main
confidentiality: PUBLIC
retention_class: AUDIT_LONG
redaction_status: NOT_REQUIRED
metadata:
  receipt_type: commit_sha
created_at: 2026-09-02T04:20:00.020Z
```
