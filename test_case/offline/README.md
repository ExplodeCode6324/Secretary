# Offline tests

从仓库根目录执行 `npm run verify`。`runtime/` 是默认回归；`audit/` 是额外审计回归，入口 `npm run test:review`。PostgreSQL 使用 `python3 test_case/offline/test-postgres.py --pg-bin /path/to/postgresql/bin`，额外数据库审计使用 `python3 test_case/offline/audit/run-world.py --pg-bin /path/to/postgresql/bin`。

`historical/` 保存历史比较/审计探针，可能依赖原场景或已变更接口，不包含在默认测试，也不声明当前全通过。当前回归使用 runtime 与 audit；历史报告不能覆盖本轮实现证据。测试设计说明见 [docs/testing.md](../../docs/testing.md)。
