# Offline tests

从仓库根目录执行 `npm run verify`。`runtime/` 是默认回归；`audit/` 是额外审计回归，入口 `npm run test:review`。PostgreSQL 使用 `python3 test_case/offline/test-postgres.py --pg-bin /path/to/postgresql/bin`，额外数据库审计使用 `python3 test_case/offline/audit/run-world.py --pg-bin /path/to/postgresql/bin`。

`historical/` 保存历史比较/审计探针，可能依赖原场景或已变更接口，不包含在默认测试，也不声明当前全通过。当前回归使用 runtime、issue2–5、issue8 与 audit；历史报告不能覆盖本轮实现证据。测试设计说明见 [docs/testing.md](../../docs/testing.md)。

`issue5/` 是设置重建与历史输入投影的正式合成回归，使用 `npm run test:issue5`；已纳入 `npm run check` 的类型检查。覆盖空提取来源及原文跨压缩、重启和再次投影的实际主模型请求，不评价真实模型的长期记忆质量。


`issue8/` 是当前 API v1/生命周期及复审缺陷的正式回归，入口 `npm run test:api`，已包含在 verify 和默认类型检查中。PG 条件用例须另用隔离数据库执行；普通 verify 的跳过不代表数据库验收。旧 UI 的三项合同测试显式 skip，保留领域/渲染测试并由新版 API 专项替代服务验收，详见[验证记录](../../docs/api/v1/verification.md)。

runtime/helpers 内旧浏览器/PTY 服务仍可能依赖退休路由，不能照历史命令把结果称为新版客户端测试。此次文档核对没有修改业务测试、放宽断言或执行真实模型调用。
