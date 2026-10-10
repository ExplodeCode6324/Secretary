# Test reports

历史报告保留原运行日期、失败记录、源代码指纹和当时的命令文本。报告里的旧路径是历史现场；新路径见 [迁移映射](../../docs/migration-map.json)，当前命令见 [测试策略](../../docs/testing.md)。不要把旧 hash 或旧 PASS 当作本次代码已经验证。

| 目录 | 报告内容 |
| --- | --- |
| [settings-20260928](settings-20260928/README.md) | World 管理、统一设置生效、数据库与模型验证 |
| reorganization-20260924 | 本次目录、文档与启动入口整理验证 |
| pi | 原 Pi runtime、live、memory、UI、用户说明报告及原始附件 |
| audit | Pi 审计执行结果 |
| pi-audit-20260922 / review | 原复核证据与说明 |
| design / design-checks | 设计检查与历史比较报告；不是当前运行证明 |
| implementation | 历次 Pi 功能复核与限制说明 |

新报告按日期/运行 ID 保留命令、环境、退出状态、源码指纹和未运行项；本目录只提交脱敏汇总与经审查附件。原始 live 会话、凭据和运行身份保留私密本地，不直接放入公开仓库。缺失附件见[清单](../../docs/unavailable-evidence.json)，保留旧路径不代表附件仍存在。Online 长期回归尚待完善。

- [World Model 历史部署验收（2026-09-28/29）](settings-deployment-20260928/README.md)：升级完整性、真实现用模型效果、完整停启与复核入口。

- [记忆体系修复候选复核（2026-10-08）](memory-review-20261008/README.md)：Issue 2–5 的合成验证、接管复核与未执行边界。


当前 Core API v1 的实现与严格工具产物证据汇总见 [verification.md](../../docs/api/v1/verification.md)。旧 Web/TUI、SSE、浏览器滚动及 `.command` 报告仅对应原版本，不适用于新版 Core；不将旧截图或通过数重新签发为当前结果。Master 已确认 aa47ad5 复审完成，本轮文档对齐单独待复核。
