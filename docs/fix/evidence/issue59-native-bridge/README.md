# FE-01 验证记录

PR #69 已建立；R2 并发修订复核中。冻结提交的最终 CI 与 Hermes 结论追加 PR 评论。

## 已执行

- Rust 25 项通过；另有一个标记 ignored 的 crash_child，由父测试分别以 enqueue/post/receipt 三种阶段实际启动并 SIGKILL，不是跳过强杀验证。
- 真 Core HTTP/SSE：权限/模式、Host/Origin、过期 token、响应丢失、同 ID 去重/冲突、实例重启、Core SIGKILL、初始快照追赶、双客户端水位、备份分叉、下载完整性与损坏拒绝。
- SQLite：原子草稿转 outbox、事务失败不推进水位、真实 SQLITE_FULL、outbox 配额保留草稿、未来迁移拒绝、数据域隔离。
- macOS WKWebView：原生启动、UI 发送及回执、草稿保存和页面重开、JS/桥快照无 token、admin 拒绝及域冲突阻断。最终原生重跑 5 项通过，包括整个进程重开、Core 暂停时保存草稿、过期实例 stop 拒绝与显式 UI 确认停止。
- 桌面 TypeScript/Svelte 检查、现有 Node/Python 测试、Rust clippy 已通过。

## 首次失败与修复依据

1. Rust 首轮 6 通过、4 失败：单 DTO validator 误叠加 API schema 根级联合约束，合法 MessageCommand/SyncPage 被拒。改为仅 `$defs` + 目标 `$ref`，缓存编译后的 validator。原 10 项全部通过，扩展回归也通过。
2. WKWebView 首轮测试包装使用顶层 `error` 字段，被嵌入 WebDriver 解释为协议错误；改为 `failure`，保留对原生拒绝码的断言，两项复测通过。
3. 原生验收重复运行时，“存在 ACCEPTED”可匹配历史命令，已收紧为本轮新 ID 受理后才通过。

## 边界

本地使用隔离 fixture Core 和真实持久 Store/HTTP/SSE；不使用用户 live 模型或个人数据。UI 是 FE-01 通信验证入口，正式页面设计由 FE-02/后续阶段完成。Linux 桌面 NOT_TESTED；Core Linux CI 不变。全量 Core 与 PostgreSQL 已完成；最终 CI/复核结果追加 PR。

重复入口见 [桌面 README](../../../../src/secretary_desktop/README.md)。原始日志存仓库外，截图和原生 fixture 位于 Git 忽略的 `.demo-data/issue59-native/`。


## 实现 R1 复核处置

- B1：投递改为 SQL 有界选择（最多 8 项），PENDING/SENDING/UNCERTAIN 优先，插入 rowid FIFO；跟踪/历史对账按最后检查时间轮转。新增同秒逆字典 ID 和历史积压回归。
- B2：显式重建清除错误与退避，保留 outbox，再从新水位重建；新增 UNSUPPORTED_SYNC 恢复回归。
- C1：notifications 显式映射 reliable_sync，真实 Core 回归通过；实例分页过期清游标并重建当前窗口。
- N1：草稿保存用独立 SQLite 连接，不等待网络同步锁；版本比较与原子入队仍由 SQLite 事务保证。
- N2/N3：投递只读取 8 行，快照最多 50 条命令、正文预览 2048 字符；SSE 首事件重置退避，帧上限含 16 KiB framing 余量。原命令完整正文仍持久保留。
- N6/N7/N10：FAILED/COMPLETED 独立显示；操作表改为固定白名单，新增路由不自动开放；每 profile 用 OS 文件锁领取投递，进程退出自动释放，无租约状态机。
- N5/N9/N11/N12：新域使用新 profile ID，保留旧库及未解决意图；FE-01 不提供删除域入口。缓存仅有最多 16 个活动窗口，切换窗口事务替换，超配额拒绝而不推进水位。订阅能力预检在清缓存前完成。SSE change 经校验后消费，持久事务统一由约 1 秒周期的 sync/changes 校验追赶，避免并行维护两个应用路径；transient 不进入持久水位。
- N13：latest 阅读锚点、下载成功提示、stop 返回类型/状态、配置缺失错误码已修正。

本地 Core verify：616 pass / 41 数据库项目 skipped / 0 fail；随后对所有 PostgreSQL 测试文件补跑：53 pass / 0 skipped / 0 fail。首轮 macOS CI 失败于 Node seed 脚本进入浏览器 tsconfig 及未 checkout Core 子模块；seed 已移到 Core 测试目录，desktop CI 加 recursive submodules。

原生 R1 修订验证：整个进程重开保留草稿、新命令按本轮新 ID 验证受理；Core SIGSTOP 后草稿实际落盘 54 ms（HTTP 超时预算 10 s）。原生保存对话框取消已由实际 macOS 面板点击和返回 CANCELLED 双重验证。

最终补测：真实 SSE 持续消费超过 31 秒后仍收到新命令变更；首次长连接测试未消费启动期事件，错误要求队列为空，已改为持续消费并断言不断线。正式 macOS bundle 构建通过（18.21 MiB）。原生显式 stop 验证 4 项通过，隔离 Core 已由 UI 确认停止。

## 实现 R2 复核处置

- B1：四处读后写事务统一为 BEGIN IMMEDIATE，避免 WAL 读快照升级冲突；界面保存链在后续编辑时恢复执行，失败当次仍保留文字、阻止发送。双连接持写锁回归在旧 DEFERRED 实现确定失败（STORAGE_UNAVAILABLE），修订后四种操作均等待并提交。
- N2：超过 1,000 项/32 MiB 时，事务内优先淘汰最旧 ACCEPTED/COMPLETED/FAILED 历史；没有可淘汰记录则拒绝入队，未解决意图与草稿不丢。新增满配额仍能发新消息及显式 stop、保留 PENDING 的回归。
- N6：desktop CI 路径增加根 package.json/package-lock.json。
- N1/N3/N4/N8：记录发送/快照网络锁等待、活动窗口完整快照、摘要回执和 transient 在线状态的当前边界，见桌面 README。没有将 FE-01 最小界面声称为 FE-02 页面完成。
- N5/N7：更新文档状态。客户端退出后 Core 继续受理是手工 HTTP 202 检查及跨进程重开附着验证；SIGKILL 是 Rust 客户端 worker 测试，WKWebView 进程重开为正常退出/重启。补原生 core.log 对实际 endpoint token 的直接扫描。

R2 指出 CI pending 的信息早于实际完成：02e8b74 的三路 CI 与汇总 verify 后续均已通过。并发修订后以新 SHA 重跑，最终证据见 PR 评论。

R2 修订验证：Rust 25 pass / 1 crash worker ignored；WKWebView 5 pass，新增真实 SQLite trigger 拒绝保存后下一次编辑恢复成功，core.log 无当前 endpoint token。首次尝试替换 WebView invoke 未触发预期失败，改用数据库 trigger 注入，测试按实际报错与后续落盘断言。Svelte/TypeScript、Node/Python、合同、fmt/clippy、文档检查通过。
