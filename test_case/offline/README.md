# Offline tests

从仓库根目录执行 `npm run verify`：依次运行类型检查、文档检查和 `tsx --test "test_case/offline/**/*.test.ts"`。全部当前套件及其 TypeScript helper 都在默认范围内，新增测试按 `*.test.ts` 命名即可。

需要 Node.js ≥ 22.19、Python 3、固定 Pi 子模块与 `npm ci`。真实模型入口在 online 目录，普通 verify 不加载模型凭据。

数据库测试统一使用 [PostgreSQL helper](helpers/postgres.ts) 注册；本地无 `SECRETARY_TEST_DATABASE_URL` 时带原因 skip，CI 缺 DSN 直接失败。有 DSN 时，每个场景在专用 PG 上创建独立空库，测试角色需要 CREATEDB。同场景重启使用同一库，其他场景不得共享残留数据。

Node 原生统计 pass/fail/skip/todo。AUD14 使用 todo 保留待 #24 处理的 Context 字段语义问题。旧 UI 三项合同测试已删除，有效领域与 DOM 安全回归保留，服务协议由 issue8 验证。issue4 仍运行且通过类型检查，下一批 #19 删除其旧恢复机制。

[历史探针](../historical/offline/README.md) 已迁出 offline，不执行、不类型检查。runtime/helpers 中面向旧 UI 的浏览器/PTY 脚本仍是历史专项辅助，不是当前验收入口。

完整命令、手动孤儿库清理、CI 及证据边界见 [测试策略](../../docs/testing.md)。
