# 验证报告索引

本目录保存各次运行的日期、源码版本、命令、首次失败与结论。当前运行入口见[测试手册](../../docs/operations.md#开发验证)，历史路径见[迁移映射](../../docs/migration-map.json)。

| 报告 | 范围 |
| --- | --- |
| [API v1 验证](../../docs/api/v1/verification.md) | 2026-10-10 的 Core、真实工具产物与跨进程记忆场景 |
| [记忆复核](memory-review-20261008/README.md) | 2026-10-08 的 Issue #2–#5 合成回归和接管审查 |
| [World 与 Settings](settings-20260928/README.md) | 数据库、设置和模型验证 |
| [历史部署验收](settings-deployment-20260928/README.md) | 当时版本的升级、停启和现用模型效果 |
| [目录整理](reorganization-20260924/README.md) | 路径、文档及启动入口迁移 |
| [任务复用](task-reuse-20260929/README.md) | 多轮执行与产物验证 |
| [流式输出](streaming-20260929/README.md) | 原 UI 版本的流式显示 |
| [活动记录](activity-20261005/README.md) | 原 UI 版本的活动展示 |
| [记忆早期记录](pi/memory-20260922/README.md) | Pi runtime 记忆与上下文验证 |

其他按日期命名的目录保留原始专项报告。旧 Web/TUI 截图和交互结论对应其当时实现。新报告记录实际 pass/fail/skip/TODO、运行环境与未运行项；公开仓库保存脱敏汇总，原始会话留在私密证据目录。不可解析的历史附件见[清单](../../docs/unavailable-evidence.json)。
