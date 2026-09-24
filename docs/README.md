# 项目文档

本目录的当前文档以 `src/pi_secretary` 的 Pi 实现为准。文档说明实现事实与边界；测试通过范围以 [测试报告](../test_case/reports/README.md) 为准。

| 文档 | 用途 |
| --- | --- |
| [设计哲学](philosophy.md) | 职责、授权、事实与模型判断的边界 |
| [架构](architecture.md) | 模块职责、Pi 复用、组件依赖 |
| [状态机](state-machines.md) | 代码实际状态变化、恢复与等待 |
| [数据流](data-flow.md) | 输入、任务、授权、记忆与 World Model 数据流 |
| [数据所有权与关联](data-model.md) | 实际写入者、ID 关联、预留字段边界 |
| [结构化数据](data/README.md) | 完整字段索引、逐结构字段与约束 |
| [数据库 schema](database.md) | PostgreSQL 表、字段、约束与事务 |
| [持久化与恢复](persistence.md) | JSONL、对象库、幂等、恢复边界 |
| [工具与接口](interfaces.md) | 主会话、执行 Agent、UI API 和程序协议 |
| [提示词与记忆](memory-and-prompts.md) | prompt 快照、工作记忆与承诺 |
| [运行手册](operations.md) | 安装、启动、停止、配置、排障 |
| [测试策略](testing.md) | offline / online 入口、证据层次、回归规划 |
| [整理说明](repository-layout.md) | 迁移规则、旧路径和运行数据注意事项 |

[BrainStorm](BrainStorm_Baseline_v3.md) 是项目开工前的原始设计，不是当前实现规范。[old](old/README.md) 存放设计阶段原始设计及早期说明，和当前代码不构成证据对应。引用 Go 实现的旧设计按 Master 要求丢弃；OpenCode Go 是模型服务名称，与被丢弃的 Go 语言实现无关。
