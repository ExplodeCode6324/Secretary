# Secretary 设计与 Pi 实现

基线：[BrainStorm Baseline v3](BrainStorm_Baseline_v3.md)。基线 SHA-256：`8e2bf44097a814a7b3455e9459538b608ff3488a5827f0887c74acebc4c8d08c`。

本目录保留通用设计、契约、测试设计与 Pi 实现。BrainStorm 原文不改写；设计检查不等于运行验收。

| 目录 | 内容 | 入口 |
| --- | --- | --- |
| state_machine | 总体协作、模块状态机、转换和守卫 | [总览](state_machine/README.md) |
| schema | World Model PostgreSQL DDL、谓词和事务设计 | [总览](schema/README.md) |
| json | 持久化状态、传输契约及字段语义 | [总览](json/README.md) |
| demo_design | 实现无关的接口、持久化、场景与验收顺序 | [总览](demo_design/README.md) |
| test | 通用测试设计、Pi 探针和历史证据 | [总览](test/README.md) |
| demo_pi | Pi 实现及其运行证据 | [复核入口](demo_pi/pi_secretary/REVIEW.md) |

建议阅读：BrainStorm → [复核清单](demo_design/REVIEW.md) → 状态机 → JSON 语义与持久化 → World Model schema → Pi 实现。

仅 World Model 使用 PostgreSQL，其他持久化域采用 JSON/JSONL 与不可变对象。具体实现能力以运行证据为准。

Go 实现及专属资料已迁至相邻的 `Secretary_go_bak`，本目录不保留其源码、运行数据或测试快照。混合对照报告的完整原件也在该归档；当前目录的 Pi 历史探针不自动继承为当前版本 PASS。
