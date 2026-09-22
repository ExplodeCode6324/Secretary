# 本次验证报告

结果：设计结构和临时 PostgreSQL 约束检查通过。BrainStorm V3 的 SHA-256 与开始时一致；没有改写基线。

| 验证内容 | 实测结果 |
| --- | --- |
| 主要 JSON 契约 | 39 类，72 个定义；另有 5 个存储封装定义 |
| Schema 示例 | 39 个正例和 5 个反例按预期通过/拒绝；另检查独立路径和时间反例 |
| 状态图 | 14 台模块状态机、131 条转换、25 条正反图路径；World Model 主张投影另有 SQL 事务状态表 |
| 文档 | 本地链接、状态枚举/守卫/字段及基线摘要检查通过 |
| PostgreSQL | 18.6 (Homebrew) 临时实例，13 张表、27 项 DDL/查询/约束检查通过 |
| 测试环境清理 | 临时 PostgreSQL 已正常停止并清理；未连接现有数据库 |

原始结果：[静态报告](static-report.json)、[PostgreSQL 报告](postgres-report.json)、[合并报告](report.json)。重复执行方法见 [README](README.md)。

SQL 检查覆盖：空库迁移、谓词种子、事实/证据/receipt/outbox 同事务、类型与时间约束、来源/FK、不可变原始主张/证据链接、一次 ACTIVE、等价支持主张、冲突候选保留、回滚、过期 revision 不更新、出站标记配对、完整查询投影。

这些结果不证明尚未实现的 Go 服务、授权入口、journal 掉电恢复、并发 worker、模型摘要语义或真实任务执行已通过。后续运行验收清单在 [IMPLEMENTATION.md](../IMPLEMENTATION.md)。
