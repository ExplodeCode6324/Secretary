# 离线回归

从仓库根目录执行 `npm run verify`，依次检查类型、文档和全部 `test_case/offline/**/*.test.ts`。需要 Node.js ≥22.19、Python 3、固定 Pi 子模块与 npm 依赖。

当前套件包括 runtime、audit、issue2、issue3、issue5、issue8、issue16、issue18、issue19。旧 issue4 恢复机制已由 #19 替换，仍适用的 ownership 回归迁入 issue19。

PostgreSQL 场景通过 [helpers/postgres.ts](helpers/postgres.ts) 注册，以 `SECRETARY_TEST_DATABASE_URL` 连接专用测试服务，每个场景创建独立库。角色需要 CREATEDB；本地未配置时报告 skip，CI 要求实际执行。

Node 汇总 pass/fail/skip/todo。AUD14 的 Context 字段语义 TODO 由 #24 跟踪。历史 UI 和负载探针见 [historical/offline](../historical/offline/README.md)，runtime/helpers 的旧浏览器辅助脚本按原版本使用。

定向入口、数据库清理和各套件覆盖见[测试手册](../../docs/testing.md)。
