# Test reports

历史报告保留原运行日期、失败记录、源代码指纹和当时的命令文本。报告里的旧路径是历史现场；新路径见 [迁移映射](../../docs/migration-map.json)，当前命令见 [测试策略](../../docs/testing.md)。不要把旧 hash 或旧 PASS 当作本次代码已经验证。

| 目录 | 报告内容 |
| --- | --- |
| reorganization-20260924 | 本次目录、文档与启动入口整理验证 |
| pi | 原 Pi runtime、live、memory、UI、用户说明报告及原始附件 |
| audit | Pi 审计执行结果 |
| pi-audit-20260922 / review | 原复核证据与说明 |
| design / design-checks | 设计检查与历史比较报告；不是当前运行证明 |
| implementation | 历次 Pi 功能复核与限制说明 |

新测试报告按日期/运行 ID 保存到本目录，保留命令、环境、退出状态、源码指纹和未运行项。Online 回归尚待完善。
