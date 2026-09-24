# 仓库整理验证 · 2026-09-24

本次将 Secretary 自有实现归入 src，测试拆为 offline / online / reports，文档以当前 Pi 实现重写。根 npm 配置成为唯一命令入口；子模块路径、运行时 schema/SQL、测试 import、子进程路径、在线报告输出和 macOS 启动脚本均同步调整。

## 验证结果

| 验证 | 结果 | 原始记录 |
| --- | --- | --- |
| TypeScript | PASS | [typecheck.txt](typecheck.txt) |
| 默认 offline | 55 PASS，1 个 PostgreSQL 项未配置 DSN 而跳过 | [offline.tap](offline.tap) |
| 补充审计 | 36 PASS，命令明确排除历史误报 AUD14 | [review.tap](review.tap) |
| 隔离 PostgreSQL | 1 PASS，覆盖默认套件跳过项 | [postgres.tap](postgres.tap) |
| PostgreSQL 补充审计 | 4 PASS | [postgres-review.tap](postgres-review.tap) |
| 格式 | PASS | [format.txt](format.txt) |
| 根目录启动/停止 | npm start → TUI；Web HTTP 200；npm run stop 后后台退出 | [entry-smoke.json](entry-smoke.json) |
| Markdown 链接、迁移目标和离线分类 | PASS，具体数量见记录 | [docs-check.json](docs-check.json) |
| 类型与字段/数据库文档再生成 | PASS，无生成漂移 | [generation-parity.json](generation-parity.json) |
| 历史报告原件 | 76 份已跟踪非 Markdown 文件逐字节一致 | [historical-evidence-integrity.json](historical-evidence-integrity.json) |

测试环境为本机 Node 22 与 PostgreSQL 18，使用临时数据目录和临时数据库。隔离启动 smoke 没有调用真实模型；未执行 online 测试，不声称新获得 LIVE_MODEL / REAL_USE 证据。

## 修正过程与证据边界

第一次 PostgreSQL runner 因目录上移层级不正确，尝试从 test_case/node_modules 启动；已修正 cwd 并重跑。首轮格式检查发现 import 换行变化，已格式化。类型生成器也统一使用当前 Prettier 格式，避免生成与 format 检查互相改写。首次失败记录保留在本目录，不覆盖成 PASS。

本次保留历史失败、原始 source-before 与已有未跟踪附件；历史 Markdown 的相对链接适配新布局，报告内命令和 hash 仍指原运行现场。旧设计明确降为历史资料，引用 Go 实现的旧说明和 Go 样例已删除；OpenCode Go provider 名称保留。

Master 授权后已通过项目自带接口正常停止原真实模型后台。`.demo-data` 与凭据原样移动到根目录，不改写历史 journal，不自动重启。旧登记程序及待执行 shell 操作的绝对路径可能需要重新登记/重新提案并授权，不能凭目录迁移复用变更后的许可。

源码与环境指纹见 [source-sha256.json](source-sha256.json)。本报告证明整理后的运行入口与当前回归结果，不证明长期在线行为稳定性。后续 online 日常回归计划见 [测试策略](../../../docs/testing.md)。
