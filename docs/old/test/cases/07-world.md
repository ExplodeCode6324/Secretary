> 历史归档：设计阶段的原始设计或早期实现说明，和当前代码不构成证据对应。命令、路径与结论仅供历史追溯；当前入口见 [项目文档](../../../README.md)。

# World Model、来源与事务

由 [catalog.json](../catalog.json) 生成；修改唯一来源后运行 `python3 test/scripts/build.py`。

通用隔离设施、竞态排序和判定规则见 [执行协议](../PROTOCOL.md)。每个子情况独立执行和记录。evidence_level 是目标证据类型，不代表已经取得；真实模型场景中的确定性持久化子项可先以 OFFLINE_RUNTIME 单独报告。

<a id="wld-001"></a>
## WLD-001 谓词类型单位关系与证据约束

P0 · 目标证据 `POSTGRES_RUNTIME` · `NOT_RUN`

依据：BrainStorm 3.3, 3.5, 5.7；语义约束 J17, J21。

规范：[TRANSACTIONS.md](../../schema/TRANSACTIONS.md)、[001_world_model.sql](../../schema/001_world_model.sql)、[002_predicates.sql](../../schema/002_predicates.sql)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：临时 PG 建立规范实体/来源/谓词和真实合成日志对象。

步骤：

1. 尝试未登记谓词、错单位/类型、scalar与object并存、错subject kind、缺证据、OBSERVED缺时间。
2. 提交合法对照。

预期与禁止结果：

- 非法请求在服务/事务边界拒绝且无事实变化。
- 合法按登记 schema。
- 授权不能修复数据不合法。

证据：入口错误；PG rows；证据对象 hash。

<a id="wld-002"></a>
## WLD-002 来源伪装和实体目录

P0 · 目标证据 `POSTGRES_RUNTIME` · `NOT_RUN`

依据：BrainStorm 3.3, 3.5, 5.7；语义约束 J17。

规范：[TRANSACTIONS.md](../../schema/TRANSACTIONS.md)、[001_world_model.sql](../../schema/001_world_model.sql)、[002_predicates.sql](../../schema/002_predicates.sql)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：模型产生 INFERRED 材料，已有 Master/模型来源身份。

步骤：

1. 伪造 MASTER source。
2. 改 source.kind/entity.kind。
3. 将 display_name 当确认事实。
4. 跨源证据。

预期与禁止结果：

- 来源与认证入口/原日志核对。
- 身份类别不可无迁移升级。
- 标签不自动成为确认事实。

证据：source/assertion/evidence 链；拒绝原因。

<a id="wld-003"></a>
## WLD-003 新事实与等价支持

P1 · 目标证据 `POSTGRES_RUNTIME` · `NOT_RUN`

依据：BrainStorm 3.3, 3.5, 5.7；语义约束 J17。

规范：[TRANSACTIONS.md](../../schema/TRANSACTIONS.md)、[001_world_model.sql](../../schema/001_world_model.sql)、[002_predicates.sql](../../schema/002_predicates.sql)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：空 slot；两个不同来源同值、不同 observed/fresh_until。

步骤：

1. 依次 ASSERT。
2. 读取当前及历史。
3. 令一来源过期。

预期与禁止结果：

- 一 ACTIVE 加独立 SUPPORTING。
- 不生成伪冲突。
- 各自来源时间 freshness 独立。
- 不覆盖原主张。

证据：slot revision；投影；每条 provenance。

<a id="wld-004"></a>
## WLD-004 知识冲突与写版本冲突区别

P0 · 目标证据 `POSTGRES_RUNTIME` · `NOT_RUN`

依据：BrainStorm 3.3, 3.5, 5.7；语义约束 J17, J02。

规范：[TRANSACTIONS.md](../../schema/TRANSACTIONS.md)、[001_world_model.sql](../../schema/001_world_model.sql)、[002_predicates.sql](../../schema/002_predicates.sql)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：同 slot 两不同值及并发 expected_revision 相同。

步骤：

1. 顺序不同值写入。
2. 另分支并发更正同 revision。

预期与禁止结果：

- 前者保留 CONTESTED 与 OPEN conflict。
- 后者一个应用、另 CONFLICT receipt。
- 不得 last-write-wins 混淆两类冲突。

证据：主张/冲突表；receipt outcomes；锁顺序。

<a id="wld-005"></a>
## WLD-005 更正撤回及支持者处理

P0 · 目标证据 `POSTGRES_RUNTIME` · `NOT_RUN`

依据：BrainStorm 3.3, 3.5, 5.7；语义约束 J17。

规范：[TRANSACTIONS.md](../../schema/TRANSACTIONS.md)、[001_world_model.sql](../../schema/001_world_model.sql)、[002_predicates.sql](../../schema/002_predicates.sql)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：ACTIVE A+SUPPORTING A，另有 CONTESTED 候选。

步骤：

1. 局部 CORRECT。
2. 显式 resolve_conflict_id+新依据解决全部。
3. RETRACT 其中一个。
4. 再次提出同值。

预期与禁止结果：

- 局部更正不吞其他分歧。
- 支持旧值者按范围 SUPERSEDED/CONTESTED。
- 仅剩一候选不自动判真。
- 历史终态不复活。

证据：全部投影前后；replaces 链；resolution evidence。

<a id="wld-006"></a>
## WLD-006 跨 slot 替换与冲突成员

P0 · 目标证据 `POSTGRES_RUNTIME` · `NOT_RUN`

依据：BrainStorm 3.3, 3.5, 5.7；语义约束 J17。

规范：[TRANSACTIONS.md](../../schema/TRANSACTIONS.md)、[001_world_model.sql](../../schema/001_world_model.sql)、[002_predicates.sql](../../schema/002_predicates.sql)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：两个不同 subject/predicate slot。

步骤：

1. CORRECT/RETRACT 指另一 slot。
2. 伪造 conflict_member。
3. RETRACT 附新值。

预期与禁止结果：

- 服务和 FK 拒绝。
- 原主张/slot revision 不非法改变。
- 合法 RETRACT 不创建空值主张。

证据：事务回滚；FK/应用错误；revision。

<a id="wld-007"></a>
## WLD-007 PG 提交结果未知恢复

P0 · 目标证据 `POSTGRES_RUNTIME` · `NOT_RUN`

依据：BrainStorm 3.3, 3.5, 5.7；语义约束 J17, J15。

规范：[TRANSACTIONS.md](../../schema/TRANSACTIONS.md)、[001_world_model.sql](../../schema/001_world_model.sql)、[002_predicates.sql](../../schema/002_predicates.sql)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：已授权 WorldCommand，稳定 change_id/request_hash。

步骤：

1. F10 COMMIT 前后断线。
2. 原事务持同键锁时启动恢复。
3. 查无 receipt 后锁内再查。

预期与禁止结果：

- 同键串行不创建新 change_id。
- 已提交只补交接。
- 真实未提交才同键恢复。
- 批准不重复消费。
- 不推广到外部动作。

证据：PG 锁/receipt；grant 消费；WorldCommand。

<a id="wld-008"></a>
## WLD-008 outbox 补交接去重

P0 · 目标证据 `POSTGRES_RUNTIME` · `NOT_RUN`

依据：BrainStorm 3.3, 3.5, 5.7；语义约束 J17, J16。

规范：[TRANSACTIONS.md](../../schema/TRANSACTIONS.md)、[001_world_model.sql](../../schema/001_world_model.sql)、[002_predicates.sql](../../schema/002_predicates.sql)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：PG receipt/outbox 已提交，JSON 可延迟。

步骤：

1. PG提交后未写JSON重启。
2. JSON durable 后 exported 前重启。
3. 多次重放 exporter。

预期与禁止结果：

- 最终一份有效审计事件。
- exported 仅在 journal durable 后。
- 关联真实 transaction ID。
- COMMITTED/CONFLICT/REJECTED按 receipt。

证据：outbox event_id；journal event；实际 tx ID。

<a id="wld-009"></a>
## WLD-009 同 change_id 同键异内容

P0 · 目标证据 `POSTGRES_RUNTIME` · `NOT_RUN`

依据：BrainStorm 3.3, 3.5, 5.7；语义约束 J01, J17。

规范：[TRANSACTIONS.md](../../schema/TRANSACTIONS.md)、[001_world_model.sql](../../schema/001_world_model.sql)、[002_predicates.sql](../../schema/002_predicates.sql)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：原变更 receipt 已存在。

步骤：

1. 同字节重投。
2. 同 change_id 改值或 request hash。
3. 并发原请求多次。

预期与禁止结果：

- 同请求旧结果。
- 异内容拒绝。
- slot 最多递增一次。
- 不可变 receipt 不覆写。

证据：请求 hash；receipt；revision 增量。

<a id="wld-010"></a>
## WLD-010 锁竞争、死锁和事务回滚

P1 · 目标证据 `POSTGRES_RUNTIME` · `NOT_RUN`

依据：BrainStorm 3.3, 3.5, 5.7；语义约束 J02, J17。

规范：[TRANSACTIONS.md](../../schema/TRANSACTIONS.md)、[001_world_model.sql](../../schema/001_world_model.sql)、[002_predicates.sql](../../schema/002_predicates.sql)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：多个并发 writer 操作相同及不同 slot。

步骤：

1. 注入确定回滚的死锁/序列化失败。
2. 用同 change_id 重试。
3. COMMIT 不明另走核验。

预期与禁止结果：

- 仅确认未提交才安全重试。
- 无丢更新/半冲突状态。
- 不同 slot 可推进。
- 网络/LLM 不持长事务。

证据：锁等待；PG事务日志；receipt/投影一致性。

<a id="wld-011"></a>
## WLD-011 有效时间、接收时间与 freshness

P0 · 目标证据 `POSTGRES_RUNTIME` · `NOT_RUN`

依据：BrainStorm 3.3, 3.5, 5.7；语义约束 J17。

规范：[TRANSACTIONS.md](../../schema/TRANSACTIONS.md)、[001_world_model.sql](../../schema/001_world_model.sql)、[002_predicates.sql](../../schema/002_predicates.sql)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：新观测先到、旧观测晚到；fresh_until null/过去/未来。

步骤：

1. 查询当前及历史 as_of。
2. 跨时区边界。
3. 改变读时刻。

预期与禁止结果：

- received_at 不覆盖更新 observed。
- as_of 是有效时间不是知识时间旅行。
- freshness 按当前读时刻。
- null=UNKNOWN。

证据：observed/received/valid 时间；查询结果。

<a id="wld-012"></a>
## WLD-012 稳定分页与变更冲突

P1 · 目标证据 `POSTGRES_RUNTIME` · `NOT_RUN`

依据：BrainStorm 3.3, 3.5, 5.7；语义约束 J17。

规范：[TRANSACTIONS.md](../../schema/TRANSACTIONS.md)、[001_world_model.sql](../../schema/001_world_model.sql)、[002_predicates.sql](../../schema/002_predicates.sql)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：多 slot 超一页，固定过滤条件。

步骤：

1. 读取页1。
2. 修改相关 slot。
3. 继续旧游标。
4. 换过滤条件重用 cursor。
5. 静态分页全读。

预期与禁止结果：

- 变更/筛选不符要求重开或明确拒绝。
- 静态无漏重。
- omitted/truncated 可见。
- 不宣称长期PG快照。

证据：游标；revision 摘要；完整ID对照集。

<a id="wld-013"></a>
## WLD-013 事实读取缺失与权限不混淆

P0 · 目标证据 `POSTGRES_RUNTIME` · `NOT_RUN`

依据：BrainStorm 3.3, 3.5, 5.7；语义约束 J17。

规范：[TRANSACTIONS.md](../../schema/TRANSACTIONS.md)、[001_world_model.sql](../../schema/001_world_model.sql)、[002_predicates.sql](../../schema/002_predicates.sql)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：权限在 Scheduler，WM 部分资料缺失/过期。

步骤：

1. memory_read 查无结果和分页省略。
2. 问是否有权限与是否设备在线。

预期与禁止结果：

- 无结果/省略不等于不存在。
- 旧在线不代表当前可执行。
- WM 不返回授权为事实。
- 实际动作仍 gate。

证据：读响应缺失标记；gate；来源。

<a id="wld-014"></a>
## WLD-014 数据库不可用与恢复隔离

P1 · 目标证据 `POSTGRES_RUNTIME` · `NOT_RUN`

依据：BrainStorm 3.3, 3.5, 5.7；语义约束 J17, J15。

规范：[TRANSACTIONS.md](../../schema/TRANSACTIONS.md)、[001_world_model.sql](../../schema/001_world_model.sql)、[002_predicates.sql](../../schema/002_predicates.sql)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：PG 暂停，独立本地任务和 UI 可工作。

步骤：

1. 提交 world.change。
2. 断网期间重复同请求。
3. 恢复 PG 与 outbox。

预期与禁止结果：

- 状态明确错误/待恢复不假称已写。
- 同 ID 补交接。
- 无依赖任务/UI 能继续。
- 未知变更不新键重做。

证据：模块延迟；WorldCommand；DB恢复账本。
