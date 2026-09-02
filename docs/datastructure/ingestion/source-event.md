# ingestion.source_event

## 1. 定义

`source_event` 是外部来源进入 Secretary 后形成的不可变接入封套。它保存来源身份、外部事件标识、业务发生时间、接入时间、原始载荷引用和去重依据，不负责解释载荷含义。

权威写入者为 Ingress Adapter。重复输入必须返回已有记录或明确的去重结果，不得创建第二条逻辑相同事件。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `source_event_id` | `uuid` | 是 | 主键 |
| `source_system` | `text` | 是 | 来源命名空间，例如 `master_chat`、`github`、`pc_activity` |
| `source_account_ref` | `text` | 否 | 受控账户逻辑标识；不得保存凭据 |
| `source_event_type` | `text` | 是 | 来源内稳定事件类型 |
| `external_event_id` | `text` | 否 | 来源系统提供的唯一事件标识 |
| `subject_entity_id` | `uuid` | 否 | 已解析主体；接入时未知可为空 |
| `event_time` | `timestamptz` | 是 | 外部事件实际发生时间；未知时使用来源可证明的最接近时间 |
| `ingest_time` | `timestamptz` | 是 | Secretary 成功持久化封套的时间 |
| `dedup_key` | `text` | 是 | 来源命名空间内的稳定去重键 |
| `payload_ref` | `text` | 是 | 不可变原始载荷对象引用 |
| `payload_hash` | `text` | 是 | 原始载荷内容哈希，格式为 `algorithm:value` |
| `schema_version` | `integer` | 是 | 接入封套版本，初始为 `1` |
| `validation_status` | `text` | 是 | `ACCEPTED` 或 `QUARANTINED` |
| `validation_errors` | `jsonb` | 否 | 机器可读错误码列表，不保存未脱敏原文 |
| `trace_id` | `uuid` | 是 | 跨层追踪标识 |
| `metadata` | `jsonb` | 是 | 已声明 Schema 的非核心来源元数据，默认空对象 |

## 3. 不可变量

1. 记录创建后不得原位修改。来源更正必须生成新事件并在元数据中引用被更正事件。
2. `(source_system, source_account_ref, dedup_key)` 在有效记录中唯一。
3. 同一去重键再次提交且 `payload_hash` 不同，必须进入隔离和告警流程，不得覆盖已有载荷。
4. `event_time` 可以早于 `ingest_time`，但不得因时钟偏差被自动改写。
5. 原始载荷中的外部文本始终作为数据处理，不得被解释为系统指令、授权或治理规则。

## 4. 关系与索引

- `subject_entity_id -> cognition.entity.entity_id`，允许延迟绑定。
- `ingestion.observation.source_event_id` 引用本记录。
- 唯一索引：`(source_system, coalesce(source_account_ref, ''), dedup_key)`。
- 重放索引：`(source_system, ingest_time, source_event_id)`。
- 业务时间索引：`(event_time, source_event_id)`。
- 建议按 `ingest_time` 月分区。

## 5. 保留与安全

元数据按审计周期保留。原始载荷保留期由来源类别和隐私策略决定。凭据、Cookie、令牌和私钥在写入对象存储前必须移除或替换为 Secret Reference。

## 6. 示例

```yaml
source_event_id: 0199a6f0-6ef0-7000-8000-000000000001
source_system: master_chat
source_event_type: message.received
external_event_id: msg-3821
event_time: 2026-09-02T04:15:00Z
ingest_time: 2026-09-02T04:15:00.120Z
dedup_key: master-chat:msg-3821
payload_ref: object://ingestion/2026/09/msg-3821
payload_hash: sha256:8d43...
schema_version: 1
validation_status: ACCEPTED
trace_id: 0199a6f0-6ef0-7000-8000-000000000099
metadata: {}
```
