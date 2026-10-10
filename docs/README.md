# 项目文档

当前实现基线是 PR #15 的 Core API v1（代码 `aa47ad5`）。Master 已确认该实现完成复审；本轮文档修订仍待 Master 复核，未合并或部署。实现事实以源码和公开合同为准，验证结论以对应版本的报告为准。本次修改清单与复核重点见[全量文档对齐记录](fix/fix_codex-issue8-api-v1_20261010_全量文档与实现对齐.md)。

| 阅读入口 | 内容与权威来源 |
| --- | --- |
| [运行手册](operations.md) | Core 启停、fixture/live 配置、迁移与排障 |
| [Core API v1](api/v1/README.md) | 当前客户端唯一 HTTP 合同、认证、命令回执、分页和精度 |
| [架构](architecture.md) | ApplicationService、领域模块、持久化与读投影 |
| [工具与接口](interfaces.md) | 模型工具、owner 命令、任务接续与程序执行 |
| [数据流](data-flow.md) | 输入受理、授权、工具产物、Settings/World 与反馈 |
| [数据所有权](data-model.md) | 领域记录和 API 记录的写入者、身份、版本 |
| [状态机](state-machines.md) | 实际流转、未知结果及恢复边界 |
| [持久化](persistence.md) | journal/CAS、独占 writer、API 回执与回退 |
| [内部数据字段](data/README.md) | 从当前运行 schema 生成；不是客户端 DTO |
| [数据库](database.md) | 从现行 SQL 生成的 World 表、约束与事务 |
| [设置生效](settings-activation.md) | 草稿、完整整理、World 提交与上下文重建 |
| [提示词与记忆](memory-and-prompts.md) | 请求容量、原文来源、承诺与显式恢复 |
| [设计哲学](philosophy.md) | 宿主状态、模型声明、许可和事实的边界 |
| [测试策略](testing.md) | 当前可执行套件、历史 UI 探针、online 边界 |
| [API v1 验证记录](api/v1/verification.md) | 四项复审修复、真实工具/API 产物/独立验算及保留失败 |
| [仓库与历史资料](repository-layout.md) | 目录、生成流程、旧路径与不可用附件 |

[客户端 v0.3](native-client-design-v0.3.md) 保留已确认的界面设计：正文 13 pt、默认 200 pt 可收起右栏；SwiftUI 尚未实现，不能将设计图、DTO 或后端能力当作 UI 验收。Core 已有任务、记忆、产物和设置接口；可靠同步、设备、附件上传等仍按能力状态和后续路线处理。

[BrainStorm](BrainStorm_Baseline_v3.md)、[old](old/README.md)、[fix](fix/) 和带日期的[测试报告](../test_case/reports/README.md)记录原设计或当时的计划/验证，不覆盖当前手册。旧 TUI/WebUI、旧 HTTP/SSE、旧双击脚本不适用于新版 Core。历史内容保留原始失败和完成边界；缺失附件见[不可用证据清单](unavailable-evidence.json)，不以占位文件伪造证据。
