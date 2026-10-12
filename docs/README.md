# 文档目录

当前手册按 `main@47b07ad`（2026-10-12）核对，包含 #20、#19、#16、#18 的实现。阅读顺序可从运行手册进入，再按需要查看 API、架构或数据参考。开发顺序统一记录在 [README](../README.md#开发路线)。

| 文档 | 内容 |
| --- | --- |
| [运行手册](operations.md) | 安装、Core 启停、fixture/live 配置、常用操作与升级 |
| [Core API v1](api/v1/README.md) | 认证、命令回执、查询、游标、Scope 与裁定 |
| [架构](architecture.md) | 模块职责、并发、生命周期与读模型 |
| [工具与接口](interfaces.md) | 主会话和执行工具、程序、工作范围、任务接续 |
| [数据流](data-flow.md) | 输入、任务、授权、记忆与设置的处理过程 |
| [数据模型](data-model.md) | 核心记录、身份、版本与公开投影 |
| [状态机](state-machines.md) | 当前状态流转与恢复处理 |
| [持久化](persistence.md) | journal、CAS、幂等、进程和任务恢复 |
| [提示词与记忆](memory-and-prompts.md) | 工作记忆、来源、承诺、重试与容量 |
| [设置生效](settings-activation.md) | 草稿、摘要、World 事务与上下文切换 |
| [设计原则](philosophy.md) | 模型与宿主的分工 |
| [测试策略](testing.md) | 统一验证、数据库、真实模型与报告 |
| [仓库结构](repository-layout.md) | 源码、生成文件与历史资料位置 |

## 参考与设计

[内部字段](data/README.md)的 89 个定义和[数据库参考](database.md)由当前 schema、SQL 生成。客户端使用独立的 [API schema](api/v1/schema.json)、[操作表](api/v1/operations.json)与 [OpenAPI](api/v1/openapi.json)。

[客户端设计 v0.3](native-client-design-v0.3.md)是 SwiftUI 的实施依据，页面开发安排在 #10。[修复记录](fix/README.md)保存各轮计划、批准和验证。[API 历史验证](api/v1/verification.md)、[测试报告](../test_case/reports/README.md)、[原始设计](old/README.md)及 [BrainStorm](BrainStorm_Baseline_v3.md)保留各自日期和版本，便于追溯项目演进。
