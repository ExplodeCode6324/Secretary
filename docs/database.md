# PostgreSQL schema

World Model 权威事实使用 `wm` schema；可重建的历史正文索引使用 `mem` schema。Session、Task、授权规则、Context 与 Consciousness 存储在本地 journal，不是 PostgreSQL 表。

权威 SQL：[001_world_model.sql](../src/schema/001_world_model.sql)、[002_predicates.sql](../src/schema/002_predicates.sql)、[003_settings.sql](../src/schema/003_settings.sql)、[004_memory_search.sql](../src/schema/004_memory_search.sql)、[queries.sql](../src/schema/queries.sql)。执行仓储：[world.ts](../src/pi_secretary/src/world.ts)。

## 迁移与事务

World.migrate 使用 advisory lock 串行化迁移；不存在 schema_version 时执行基线，再应用 predicate seed 并记录版本 2，再执行 settings_batch_receipt 的版本 3 和 mem/aliases 的版本 4 迁移。基线/seed 自带事务；migrate 在失败时 rollback 并释放锁。当前入口为 owner 显式 POST /api/v1/admin/world/migrate，再按请求回执确认；Core CLI 不处理 --migrate。

变更通过 Settings 协调器先摘要并预检 context。认证 local-owner 的 Settings API 记录明确应用证据；模型提案仍经授权。数据库事务检查实体、predicate 与 slot revision；整批原子提交并保存 settings_batch_receipt。change_id/request_id/request_hash 支持回执去重和冲突检查。assertion、状态投影、冲突、证据、change_receipt 与 audit_outbox 在事务中提交；JSONL 审计导出属于独立可恢复桥接。

## 关系图

```mermaid
erDiagram
  entity ||--o{ fact_slot : subject
  predicate ||--o{ fact_slot : defines
  fact_slot ||--o{ assertion : versions
  source ||--o{ assertion : provenance
  assertion ||--|| assertion_state : projection
  assertion ||--o{ assertion_evidence : evidence
  evidence ||--o{ assertion_evidence : content
  fact_slot ||--o{ conflict : conflicts
  conflict ||--o{ conflict_member : members
  change_receipt ||--o| audit_outbox : export
```

## 表字段与约束

以下定义直接从当前 SQL 生成，包含默认值、外键、CHECK、UNIQUE 与延迟约束。

### wm.schema_version

```sql
version integer PRIMARY KEY CHECK (version > 0),
    installed_at timestamptz NOT NULL DEFAULT now()
```

### wm.entity

```sql
entity_id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('PERSON','ORGANIZATION','PROJECT','DEVICE','SERVICE','RESOURCE','GOAL')),
    display_name text NOT NULL CHECK (length(display_name)>0),
    external_key text UNIQUE,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision>0),
    retired_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
```

### wm.source

```sql
source_id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('MASTER','OBSERVATION','TASK_REPORT','MODEL_INFERENCE')),
    source_key text NOT NULL UNIQUE,
    description text NOT NULL,
    retired_at timestamptz
```

### wm.predicate

```sql
predicate_key text PRIMARY KEY CHECK (predicate_key ~ '^[a-z][a-z0-9_.]+$'),
    description text NOT NULL,
    subject_kinds text[] NOT NULL CHECK (cardinality(subject_kinds)>0),
    value_type text NOT NULL CHECK (value_type IN ('STRING','NUMBER','BOOLEAN','OBJECT','ARRAY','ENTITY')),
    cardinality text NOT NULL CHECK (cardinality IN ('SINGLE','MULTI')),
    unit text,
    value_schema jsonb NOT NULL CHECK (jsonb_typeof(value_schema)='object'),
    definition_revision bigint NOT NULL DEFAULT 1 CHECK (definition_revision>0)
```

### wm.fact_slot

```sql
slot_id uuid PRIMARY KEY,
    subject_id uuid NOT NULL REFERENCES wm.entity(entity_id),
    predicate_key text NOT NULL REFERENCES wm.predicate(predicate_key),
    scope_key text NOT NULL DEFAULT '',
    revision bigint NOT NULL DEFAULT 0 CHECK (revision>=0),
    UNIQUE(subject_id,predicate_key,scope_key)
```

### wm.change_receipt

```sql
change_id uuid PRIMARY KEY,
    request_id uuid NOT NULL UNIQUE,
    request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    outcome text NOT NULL CHECK (outcome IN ('APPLIED','CONFLICT','REJECTED')),
    result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
    committed_at timestamptz NOT NULL DEFAULT now()
```

### wm.assertion

```sql
assertion_id uuid PRIMARY KEY,
    slot_id uuid NOT NULL REFERENCES wm.fact_slot(slot_id),
    slot_revision bigint NOT NULL CHECK (slot_revision>0),
    source_id uuid NOT NULL REFERENCES wm.source(source_id),
    change_id uuid NOT NULL REFERENCES wm.change_receipt(change_id) DEFERRABLE INITIALLY DEFERRED,
    value jsonb,
    object_entity_id uuid REFERENCES wm.entity(entity_id),
    epistemic text NOT NULL CHECK (epistemic IN ('OBSERVED','REPORTED','INFERRED','UNRESOLVED')),
    observed_at timestamptz,
    received_at timestamptz NOT NULL,
    valid_from timestamptz NOT NULL,
    valid_to timestamptz,
    fresh_until timestamptz,
    scope_description text NOT NULL CHECK (length(scope_description)>0),
    replaces_assertion_id uuid,
    UNIQUE(assertion_id,slot_id),
    UNIQUE(slot_id,slot_revision),
    FOREIGN KEY(replaces_assertion_id,slot_id) REFERENCES wm.assertion(assertion_id,slot_id),
    CHECK ((value IS NOT NULL AND value <> 'null'::jsonb AND object_entity_id IS NULL)
        OR (value IS NULL AND object_entity_id IS NOT NULL)),
    CHECK (valid_to IS NULL OR valid_to>valid_from),
    CHECK (fresh_until IS NULL OR fresh_until>=valid_from),
    CHECK (epistemic<>'OBSERVED' OR observed_at IS NOT NULL),
    CHECK (replaces_assertion_id IS NULL OR replaces_assertion_id<>assertion_id)
```

### wm.assertion_state

```sql
assertion_id uuid PRIMARY KEY,
    slot_id uuid NOT NULL,
    status text NOT NULL CHECK (status IN ('ACTIVE','SUPPORTING','CONTESTED','RETRACTED','SUPERSEDED')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision>0),
    changed_by uuid NOT NULL REFERENCES wm.change_receipt(change_id) DEFERRABLE INITIALLY DEFERRED,
    changed_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(assertion_id,slot_id) REFERENCES wm.assertion(assertion_id,slot_id)
```

### wm.evidence

```sql
evidence_id uuid PRIMARY KEY,
    log_event_id uuid NOT NULL,
    object_path text NOT NULL CHECK (object_path !~ '(^/|(^|/)\.\.(/|$))'),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    media_type text NOT NULL,
    byte_count bigint NOT NULL CHECK (byte_count>=0),
    UNIQUE(log_event_id,sha256)
```

### wm.assertion_evidence

```sql
assertion_id uuid NOT NULL REFERENCES wm.assertion(assertion_id),
    evidence_id uuid NOT NULL REFERENCES wm.evidence(evidence_id),
    PRIMARY KEY(assertion_id,evidence_id)
```

### wm.conflict

```sql
conflict_id uuid PRIMARY KEY,
    slot_id uuid NOT NULL REFERENCES wm.fact_slot(slot_id),
    status text NOT NULL CHECK (status IN ('OPEN','RESOLVED')),
    opened_by uuid NOT NULL REFERENCES wm.change_receipt(change_id) DEFERRABLE INITIALLY DEFERRED,
    resolved_by uuid REFERENCES wm.change_receipt(change_id) DEFERRABLE INITIALLY DEFERRED,
    resolution_note text,
    UNIQUE(conflict_id,slot_id),
    CHECK ((status='OPEN' AND resolved_by IS NULL AND resolution_note IS NULL)
       OR (status='RESOLVED' AND resolved_by IS NOT NULL AND resolution_note IS NOT NULL AND length(resolution_note)>0))
```

### wm.conflict_member

```sql
conflict_id uuid NOT NULL,
    slot_id uuid NOT NULL,
    assertion_id uuid NOT NULL,
    PRIMARY KEY(conflict_id,assertion_id),
    FOREIGN KEY(conflict_id,slot_id) REFERENCES wm.conflict(conflict_id,slot_id),
    FOREIGN KEY(assertion_id,slot_id) REFERENCES wm.assertion(assertion_id,slot_id)
```

### wm.audit_outbox

```sql
event_id uuid PRIMARY KEY,
    change_id uuid NOT NULL UNIQUE REFERENCES wm.change_receipt(change_id),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    exported_journal_txn uuid,
    exported_at timestamptz,
    CHECK ((exported_journal_txn IS NULL)=(exported_at IS NULL))
```

### wm.settings_batch_receipt

```sql
application_id uuid PRIMARY KEY,
    request_hash text NOT NULL,
    result jsonb NOT NULL,
    committed_at timestamptz NOT NULL DEFAULT now()
```

### mem.document

```sql
source_id text NOT NULL,
    event_id uuid NOT NULL,
    log_sequence bigint NOT NULL,
    occurred_at timestamptz NOT NULL,
    kind text NOT NULL CHECK (kind IN ('input','reply','task','notification')),
    session_id uuid,
    scope_id uuid,
    task_id uuid,
    body_hash text NOT NULL,
    PRIMARY KEY (source_id,event_id)
```

### mem.chunk

```sql
source_id text NOT NULL,
    event_id uuid NOT NULL,
    chunk_index integer NOT NULL,
    body_offset integer NOT NULL,
    body text NOT NULL,
    PRIMARY KEY (source_id,event_id,chunk_index),
    FOREIGN KEY (source_id,event_id) REFERENCES mem.document ON DELETE CASCADE
```

### mem.checkpoint

```sql
singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    source_id text NOT NULL,
    policy_version integer NOT NULL,
    journal_sequence bigint NOT NULL,
    journal_digest text NOT NULL,
    document_count bigint NOT NULL,
    chunk_count bigint NOT NULL
```

## 索引、触发器与读模型

assertion_state 以部分唯一索引保证每个 slot 至多一个 ACTIVE；conflict 每个 slot 至多一个 OPEN。来源/slot 时间索引支持事实读取，pending_audit_exports 支持未导出事件扫描。

validate_slot 检查 subject kind 与 SINGLE/MULTI 的 scope_key；validate_assertion 检查 slot revision、值类型与 ENTITY 引用。assertion、receipt、evidence 及证据关联禁止修改删除；source 身份字段不可改；延迟触发器要求每条 assertion 有证据。更正与撤回通过新的变更和投影表达。settings_batch_receipt 也禁止更新和删除，以保留批次幂等依据。

World 仓储使用 Ajv 验证 predicate.value_schema，并检查证据对象和 CAS。queries.sql 返回当前投影、冲突、来源及有效性信息。

## Predicate 初始目录

初始十项：person.display_name、person.height、person.contact、person.member_of、preference.statement、goal.statement、project.constraint、resource.location、resource.depends_on、resource.observed_state。类型、基数、单位和 JSON 值约束以 002_predicates.sql 为准。这些 predicate 描述 World 中可登记的事实类型。

## 数据库配置

World 使用专用数据库，连接角色和备份由部署环境配置。DDL 撤销 PUBLIC 权限；Core 的 owner 授权在应用层处理。

## 历史检索与别名

版本 4 安装 pg_trgm，增加 wm.entity.aliases（非空 text[]，默认空数组），并建立 mem.document、mem.chunk 与 mem.checkpoint。别名经 Settings/WorldCatalogChange 授权维护；旧 ENTITY 编辑缺省保留已有别名。实体名称或别名有多个匹配时返回候选。

检索投影从 journal 事务帧有界推进，完整正文按 Unicode 边界分块，正文与水位同事务提交。水位绑定来源、策略版本与 journal digest；重启发现来源不符或数据缺失则重建。wm 权威事实不受索引重建影响。

正文使用 GIN pg_trgm 与参数化字面 ILIKE，按事件去重、时间倒序和稳定事件键返回。时间范围为 [from,to)，过滤联合生效；SQL 超时为 5 秒并返回 search_timeout。locale 决定 trigram 提取，中文命中与性能在实际 locale 下分别验证。两字模式可能退化为扫描。

部署验收只读核对 server_version、datctype、datcollate、datlocprovider、datlocale 与 datcollversion；配置不同则在匹配隔离库重复中文验证。业务数据实例不用于测试。原文从 journal/CAS 分片读取，mem 可重建。
