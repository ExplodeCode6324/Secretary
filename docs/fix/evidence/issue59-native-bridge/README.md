# FE-01 验证记录

当前为实施中证据，最终提交和 CI 结论在完成后补齐。

## 已执行

- Rust 18 项通过；另有一个标记 ignored 的 crash_child，由父测试分别以 enqueue/post/receipt 三种阶段实际启动并 SIGKILL，不是跳过强杀验证。
- 真 Core HTTP/SSE：权限/模式、Host/Origin、过期 token、响应丢失、同 ID 去重/冲突、实例重启、Core SIGKILL、初始快照追赶、双客户端水位、备份分叉、下载完整性与损坏拒绝。
- SQLite：原子草稿转 outbox、事务失败不推进水位、真实 SQLITE_FULL、outbox 配额保留草稿、未来迁移拒绝、数据域隔离。
- macOS WKWebView：原生启动、UI 发送及回执、草稿保存和页面重开、JS/桥快照无 token、admin 拒绝及域冲突阻断。后续最终原生重跑与进程重开结果待补。
- 桌面 TypeScript/Svelte 检查、现有 Node/Python 测试、Rust clippy 已通过。

## 首次失败与修复依据

1. Rust 首轮 6 通过、4 失败：单 DTO validator 误叠加 API schema 根级联合约束，合法 MessageCommand/SyncPage 被拒。改为仅 `$defs` + 目标 `$ref`，缓存编译后的 validator。原 10 项全部通过，扩展回归也通过。
2. WKWebView 首轮测试包装使用顶层 `error` 字段，被嵌入 WebDriver 解释为协议错误；改为 `failure`，保留对原生拒绝码的断言，两项复测通过。
3. 原生验收重复运行时，“存在 ACCEPTED”可匹配历史命令，已收紧为本轮新 ID 受理后才通过。

## 边界

本地使用隔离 fixture Core 和真实持久 Store/HTTP/SSE；不使用用户 live 模型或个人数据。UI 是 FE-01 通信验证入口，正式页面设计由 FE-02/后续阶段完成。Linux 桌面 NOT_TESTED；Core Linux CI 不变。全量 Core 测试及 PostgreSQL、最终 CI/复核尚在进行。

重复入口见 [桌面 README](../../../../src/secretary_desktop/README.md)。原始日志存仓库外，截图和原生 fixture 位于 Git 忽略的 `.demo-data/issue59-native/`。
