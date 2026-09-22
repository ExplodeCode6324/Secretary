# Master 复核入口

本轮新增四组设计，未改动 BrainStorm_Baseline_v3.md，也未编写 demo 实现或推送远端。

| 目录 | 内容 |
| --- | --- |
| [state_machine](../state_machine/README.md) | 总体组合状态机，14 个模块状态机，状态/事件/守卫/提交/恢复 |
| [schema](../schema/README.md) | World Model PostgreSQL 表、约束、种子谓词、查询、事务与跨存储交接 |
| [json](../json/README.md) | JSON Schema、逐字段字典、形状示例、语义约束，覆盖 Context/提案/分派/日志及所需补充 |
| [demo_design](README.md) | Go 模块/目录/函数、API、持久化、场景、实施顺序与验证 |

## 优先复核的实现取舍

1. 接受“只有 World Model 使用 PostgreSQL”，其余使用 JSON；为保证 ACK 后不丢数据，增加单写 journal 和不可变对象，snapshot 只是缓存。
2. 整体状态使用组合模型，分别描述宿主、输入、模型调用、整理、计划、执行、短期留存、操作、批准、普通决定、反馈、通知、认知写入和程序登记。
3. World Model 采用登记谓词/实体/不可变主张/来源证据/冲突，事实的生命周期与事实是否确定分开；PostgreSQL 内不放权限范围。
4. 一次批准绑定一个操作意图；跨进程恢复检查同一批准是否仍适用，实际 dispatch 原子消费。已消费但回执丢失时停止核验。
5. 定时任务接受后立即初始化目录，agent 在满足执行条件时拉起。共享 workspace 按 task_id，原始材料按 execution_id 留存。
6. 固定 UTC 周期作为初期周期调度；环境事件仅保留登记接口，日历 cron、未知外部来源和复杂隔离不在初期实现。
7. 本次具体默认候选和尚未定死的实现项集中在 [DECISIONS.md](DECISIONS.md)，无需重新散落各章。

## 与 BrainStorm 的对应

| 已确认职责 | 设计位置 |
| --- | --- |
| 2.4 外部新输入与驱动 | Host/Input/Call 状态机；JSON Input/Context/ModelCall；PERSISTENCE 的输入事务 |
| 3.2 Consciousness 维护与交接 | Compaction 状态机；Consciousness/CompactionJob/WorkItem；SCENARIOS 2 |
| 3.3、3.5 来源与状态权威 | schema 全目录；JSON Provenance/WorldReadResult；J17 |
| 5.5、5.6 反馈、决定、接续与回收 | Execution/Retention/Decision/Feedback；Checkpoint/TaskResult/ArchiveManifest |
| 5.7 授权检查与有效范围 | Operation/Authorization；ApprovalCommand/AuthorizationRule/SafetyRule；API 独立入口 |
| 2.5、5.8 唯一会话与恢复 | Session、Owner epoch、精确 Context、PERSISTENCE 与 SCENARIOS 8 |
| 5.2、5.4 程序登记与分派 | Program/Plan/Execution；ProgramRegistration/Invocation/Result；Go registry 与 executor |
| 3.4 Operation Log | OperationLogRecord 与不可变对象；MAIN/TASK/SYSTEM 逻辑流；长期历史不跟随退休删除 |

建议先看前两张总览，再看本页的七项取舍。字段细节可以按模块逐项复核。本包是实现提案，复核后的修改直接落回对应文件，不另复制版本。
