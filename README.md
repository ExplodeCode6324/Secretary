# Secretary demo 设计包

基线：[BrainStorm Baseline v3](BrainStorm_Baseline_v3.md)。基线 SHA-256：`8e2bf44097a814a7b3455e9459538b608ff3488a5827f0887c74acebc4c8d08c`。

本包是供 Master 复核的详细设计；未实现 Go 应用，未接入模型或生产数据。BrainStorm 原文不改写。新增实现选择在 [设计取舍](demo_design/DECISIONS.md) 标明，不能把设计验证视为运行验收。

| 目录 | 内容 | 入口 |
| --- | --- | --- |
| state_machine | 整体协作、14 个模块状态机、转换表与守卫条件 | [总览](state_machine/README.md) |
| schema | 仅 World Model 的 PostgreSQL DDL、预定义谓词、事务与查询设计 | [总览](schema/README.md) |
| json | 其余持久化状态和各环节传输契约、字段字典与示例 | [总览](json/README.md) |
| demo_design | Go 模块/文件/函数安排、持久化协议、接口与实施验收顺序 | [总览](demo_design/README.md) |

建议阅读顺序：BrainStorm → [复核清单](demo_design/REVIEW.md) → 整体状态机 → JSON 语义与持久化 → World Model schema → Go 模块与流程。

仅 World Model 使用 PostgreSQL。Context、Consciousness、Scheduler、授权、日志采用不可变 JSON 对象、JSONL 事务日志及可重建快照；它们需要可靠持久化，并非仅内存结构。没有引入 SQLite、Redis 或消息队列。证据范围与实测结果见 [检查报告](demo_design/checks/report.json)。
