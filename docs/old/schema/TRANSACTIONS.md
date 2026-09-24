> 历史归档：设计阶段的原始设计或早期实现说明，和当前代码不构成证据对应。命令、路径与结论仅供历史追溯；当前入口见 [项目文档](../../README.md)。

# World Model 写入事务与 JSON 映射

## 写入步骤

入口接收 [WorldChange](../json/FIELDS.md)，按注册字段/value_schema、来源、对象、时间及证据检查；所需授权只由 Scheduler 判定。最终放行后，World Model 后端执行一次短 PG 事务（READ COMMITTED + 显式锁），不在事务内调用 LLM/网络。

1. `pg_advisory_xact_lock(hashtextextended(change_id::text,0))` 串行同 change_id；查询 change_receipt。同键同 hash 返回旧结果，不同 hash 拒绝。
2. 依据 subject_id、predicate_key、scope_key 查找/创建 slot（初始 revision=0），唯一键解决并发创建；`SELECT ... FOR UPDATE` 锁定 slot，再读当前 revision。
3. expected_revision 不匹配：不改变事实；写 CONFLICT receipt 与 outbox 后提交。此 change_id 已结束，修订提案使用新 change_id。
4. 验证 ASSERT/CORRECT/RETRACT 和 replaces 指向同 slot；递增 slot revision。插入新的不可变主张/证据链接，或对 RETRACT 更新状态。RETRACT 不创建空 value 主张，但同样递增 slot revision并保存 receipt。
5. ASSERT：无现存候选时 ACTIVE；与有效候选有分歧时，将全部相关候选设 CONTESTED 并建立 conflict；与当前 ACTIVE 内容等价的新来源主张保存为 SUPPORTING，保留独立来源/时间/证据，不伪造分歧，也不覆盖原记录。已有未决分歧时新主张仍进入 CONTESTED。等价判断由谓词登记的值规则完成，首版对规范单位下的 JSONB 值或相同关系对象作精确比较。
6. CORRECT：必须有明确纠正依据；替代指定旧主张，新主张保留 replaces 链。存在其他未解决候选时，新主张仍 CONTESTED；不能单凭主会话“纠正”隐藏其余候选。解决整个冲突需新依据明确处理全部候选，逐个状态变更在同一 slot 事务内完成。
7. RETRACT：指定候选变 RETRACTED。仅剩一个未解决候选也不能自动将其变成已证实事实；由明确的纠正/核验规则决定是否 ACTIVE。
8. 写 change_receipt（request_hash/outcome/结果含 slot revision 与相关 assertion IDs）和 audit_outbox（完整前后状态差异及引用）后 COMMIT。

不可变 assertion/evidence/receipt 与可更新投影分开。所有状态变化必须有对应 receipt/outbox；普通应用不允许绕过事务仓储直接写表。数据库约束不是授权引擎。

[PostgreSQL 隔离文档](https://www.postgresql.org/docs/18/transaction-iso.html)说明各隔离级别；这里显式锁当前 slot 并核对 revision。批量变更多 slot 时按 UUID 顺序加锁，demo API 当前只接收单 slot 变更。序列化/死锁错误可在确认未提交后用同 change_id 重试；COMMIT 回执不明先查询 receipt。

## 字段映射

| JSON 字段 | SQL 落点/处理 |
| --- | --- |
| WorldChange.change_id/request_id/request_hash | change_receipt 的稳定幂等身份；outbox 关联 |
| subject_id/predicate_key/scope_key | fact_slot 唯一键 |
| expected_revision | 锁内比较 fact_slot.revision |
| assertion_id/value/object_entity_id | assertion；RETRACT 时 assertion_id 表示被处理主张并须与 replaces 一致 |
| source_id / provenance.source_id | 必须相等，映射 source FK |
| provenance.epistemic/observed_at/received_at/scope | assertion 对应字段 |
| provenance.evidence | 注册 evidence；关联 assertion_evidence；log_event_id 明确取 EvidenceRef.log_event_id；content 映射对象路径/hash/bytes/media_type |
| valid_from/valid_to/fresh_until | assertion 时间字段 |
| mode/replaces_assertion_id | 仓储动作与同 slot 替代链 |
| AuthorizationRequest / grant / rule scope | 不进入任何 wm 表；Scheduler JSON 保存并检查 |
| WorldReadResult.facts | 查询投影含状态、slot revision、候选证据与 freshness |

## 跨存储结果

PG receipt 是 World Model 写入是否提交的依据；JSON WorldCommand 是调度/交接状态。PG 已提交而 JSON 仍 APPLYING，不执行新写入，只补 receipt/audit 交接。具体协议统一见 [PERSISTENCE.md](../demo_design/PERSISTENCE.md)。

## 迁移与查询限制

按 001、002 顺序应用到空白专用数据库。schema_version 不替代迁移工具；未来按增量编号迁移，禁止删除当前表重建。queries.sql 是带位置参数的查询模板，不是直接运行的 migration。长期保留主张/证据，失效通过投影状态表达。索引先覆盖主键、slot、source/time、待导出 outbox；全文/向量检索不在本 demo 基线增加。

## 实体、来源与冲突解决入口

WorldCatalogChange 与 WorldChange 共用 WorldCommand、统一授权、change_id/receipt/outbox 协议。UPSERT_ENTITY 在新实体 expected_revision=0 时插入；更新时锁 entity 并比较 revision，只修订展示标签/外部键，kind 变化另行迁移。REGISTER_SOURCE 使用预分配 source_id 创建不可变来源身份，冲突 key 返回 CONFLICT；不将模型来源升级为 Master 来源。两种写入将请求、证据、前后值完整存入 receipt/outbox。最初的 Master source 可由人工 bootstrap 经同协议建立；没有任何来源时不要求伪造已有 source_id。

实体 display_name 是检索标签，不代表独立确认的姓名事实；事实仍使用 assertion。predicate 的定义/类型/subject_kinds 不允许在线任意修改，否则旧主张可能不符合新定义；初期由人工增量 SQL 迁移，审计记录迁移版本和操作者。

CORRECT 带 resolve_conflict_id 和 resolution_note 时，校验 conflict 属于同 slot 并仍 OPEN；锁内将所有现存 CONTESTED 候选设 SUPERSEDED、新主张 ACTIVE、conflict RESOLVED。新主张的证据与 resolution_note 必须说明本次明确纠正为何处理整个冲突。没有这两个字段则仅替换指定候选，其余分歧保留。不做模型 confidence 阈值自动投票。

assertion_evidence 不可删除或挪到另一主张；追加来源证据可新增链接。assertion_state、fact_slot revision、conflict 状态和 outbox 内容的事务一致性由仓储服务负责，数据库的结构约束不是整个业务协议的完整实现。

## 查询时间与分页

WorldQuery.as_of 指事实适用时间，默认按调用方明确的当前 UTC；并不表示“恢复当时我们知道的全部状态”。历史读取可返回已更正/撤回主张及其 receipt 轨迹，精确的知识时间旅行投影不是首版功能。分页 cursor 编码过滤条件摘要、稳定 (slot_id, assertion_id) 排序边界和查询起始时间；跨页若相关 slot revision 改变，返回需重开查询的 CONFLICT，不能声称处于同一冻结快照。实现也可在短查询事务中一次收集匹配 ID 后分页；不跨模型思考时间保持 PG 事务。

freshness 以服务器本次读取时间比较 fresh_until，不以 WorldQuery.as_of 冒充当前新鲜度。查询结果的 observed_db_at 保存读取时间；所有时间统一编码成 UTC RFC3339，避免直接透传数据库 JSON 的时区显示格式。

## 主张投影的状态转换

这是 assertion_state 的领域状态，不与 WorldCommand 的提交状态混用。一次数据库事务可以同时修改同 slot 多条投影；历史 assertion 本身不改写。

| 当前投影 | 事件/条件 | 提交后的状态 |
| --- | --- | --- |
| 尚未保存 | ASSERT 且无有效候选 | ACTIVE |
| 尚未保存 | ASSERT 与现 ACTIVE 等价且没有未决分歧 | SUPPORTING |
| ACTIVE / SUPPORTING | 收到实质冲突主张 | CONTESTED；新候选同为 CONTESTED |
| CONTESTED | 新候选加入未决分歧 | 原状态保持；新候选 CONTESTED |
| ACTIVE / SUPPORTING / CONTESTED | 有依据的 RETRACT | RETRACTED；其余候选不自动判真 |
| ACTIVE / SUPPORTING / CONTESTED | CORRECT 明确替代本主张 | SUPERSEDED；新主张按是否仍有分歧进入 ACTIVE 或 CONTESTED |
| CONTESTED | 带依据解决整个 conflict | 全部旧候选 SUPERSEDED；新主张 ACTIVE |
| RETRACTED / SUPERSEDED | 后续重新提出同一事实 | 旧状态不复活，创建新 assertion |

SUPPORTING 可与 ACTIVE 一起读取，但每条的 freshness/provenance 独立，不能因新支持者而改写原观测时间。CORRECT 改变事实值时，同 slot 原 ACTIVE 的 SUPPORTING 主张也必须在事务中处理：明确更正的覆盖范围包含它们则 SUPERSEDED，否则保留为 CONTESTED 并建立分歧；不能留在 SUPPORTING 而支持已经不同的新值。状态/冲突组合的完整迁移由仓储守卫校验，DDL 仅约束字段和引用。
