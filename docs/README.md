# 文档

现行前端设计、组件、技术分工和验收统一从 [Current Frontend Spec](frontend/README.md) 进入。

从运行手册开始使用 Core；架构与数据流解释模块如何协作，不变量提供实现和测试证据。

| 文档 | 内容 |
| --- | --- |
| [运行手册](operations.md) | 安装、启停、模型与数据库配置、备份、排障和验证 |
| [架构](architecture.md) | 模块职责、进程、并发和存储 |
| [数据流](data-flow.md) | 对话、任务、记忆、设置与通知 |
| [系统不变量](invariants.md) | 持久化、授权、恢复及来源约束，附代码与测试 |
| [记忆与提示词](memory-and-prompts.md) | 请求组成、检索、输入退出、重试和预算 |
| [Core API v1](api/v1/README.md) | 客户端合同、命令回执、分页与同步 |
| [服务端推送](api/v1/push.md) | 目标、凭据、免打扰与发送状态 |

## 源码与参考

[src/pi_secretary](../src/pi_secretary/src/app.ts) 保存 Core 实现，[src/pi_resource](../src/pi_resource/README.md) 为固定 Pi 子模块。[内部字段](data/README.md)和[数据库参考](database.md)由 schema/SQL 生成，API 的 [schema](api/v1/schema.json)、[操作表](api/v1/operations.json)和 [OpenAPI](api/v1/openapi.json)单独维护公开合同。[离线测试](../test_case/offline/README.md)、[在线测试](../test_case/online/README.md)及[报告](../test_case/reports/README.md)分别组织验证。

[修复计划](fix/README.md)记录当前工作；[历史计划](fix/archive/index.md)、[API 验证](api/v1/verification.md)、[同步验收](api/v1/issue9-verification.md)保留对应版本结论。[原始设计](old/README.md)、[BrainStorm](BrainStorm_Baseline_v3.md)和[已废弃 SwiftUI 设计](old/native-client-design-v0.3.md)用于追溯。产品路线见[项目 README](../README.md#开发路线)。
