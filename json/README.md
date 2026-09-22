# JSON 数据契约

[contracts.schema.json](contracts.schema.json) 使用 JSON Schema Draft 2020-12。每个对象有固定 `record_type` 与 `schema_version=1`，`additionalProperties=false`。直接验证根 schema 或指定 `$defs`。验证器必须启用 format 校验。主契约清单在 [catalog.json](catalog.json)，字段说明在 [FIELDS.md](FIELDS.md)。

| 分组 | 契约 |
| --- | --- |
| 主会话与 Context | Session、Input、Context、ModelCall |
| Consciousness | Consciousness、CompactionJob、WorkItem |
| Scheduler | TaskProposal、TaskPlan、Execution、Dispatch、WorkerReceipt、TaskQuery、TaskQueryResult、TaskControlCommand |
| 结果与接续 | Checkpoint、TaskResult、Artifact、Feedback、ArchiveManifest |
| 决定与授权 | DecisionRequest、Operation、AuthorizationRequest、ApprovalCommand、AuthorizationRule、SafetyRule |
| 程序与通知 | ProgramRegistration、ProgramInvocation、ProgramResult、Notification |
| World Model API | WorldChange、WorldCatalogChange、WorldCommand、WorldQuery、WorldReadResult、MemoryReadRequest、MemoryReadResult |
| 日志与可靠存储 | OperationLogRecord、JournalTransaction、Mutation、CommandReceipt、ObjectRef |
| 配置 | RuntimeConfig |

字段覆盖对象身份、来源/因果、状态/版本、时间、内容引用、幂等键与错误。Schema 验证不等于身份认证、授权或数据库引用完整性；这些要求见 [SEMANTICS.md](SEMANTICS.md)。

[examples/valid](examples/valid) 是每类对象的最小完整结构示例，UUID、路径和散列为合成占位，不能当作可直接接续的真实数据。跨对象完整工作流见 [SCENARIOS.md](../demo_design/SCENARIOS.md)。[examples/invalid/index.json](examples/invalid/index.json) 说明反例应被拒绝的原因。

JSON 本身不是数据库事务。权威修改采用 [持久化协议](../demo_design/PERSISTENCE.md)；Context 与原始日志大内容放不可变对象，记录仅引用，不将所有内容反复复制进每个状态快照。
