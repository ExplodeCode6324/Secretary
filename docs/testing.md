# 测试策略

[test_case](../test_case/README.md) 将可执行 offline、显式 online 与每次报告分开。静态原始测试设计仅在 docs/old 中保留，不计入当前运行覆盖。

```sh
npm run verify
npm run test:review
python3 test_case/offline/test-postgres.py --pg-bin /path/to/postgresql/bin
python3 test_case/offline/audit/run-world.py --pg-bin /path/to/postgresql/bin
```

普通 offline 测试涵盖 Store、Host、Scheduler、授权、记忆、说明、shell、TUI/Web、崩溃恢复。world.test 和 settings.test 中依赖数据库的用例在无测试 DSN 时跳过；PostgreSQL runner 创建临时 Unix socket 集群，串行执行这两个文件及实际 TypeScript 仓储，结束后停止清理，不连接应用数据库。review 的 AUD14 是历史误报并显式排除，不能声称全部历史探针无例外通过。

显式在线入口：

```sh
npm run test:live -- deepseek-v4.1-flash chain gpt-5.6-luna
npm run test:instructions:live
node --import tsx test_case/online/verify-memory-live.ts <数据目录完整副本> <报告路径>
```

这些命令会产生 API 用量。test-live 支持 chain / missing / unknown / transport / reject，驾驶器只代行场景限定的预期写入许可；故障注入不是 provider 自然故障。verify-memory-live 独占指定目录并执行记忆整理，优先对完整副本使用；它不启动调度 pump。普通 npm test 不包含这些脚本。

## Online 后续优化

现有 online 主要是短场景链路和特定功能探针。需要建设更接近日常使用、能够持续衡量行为稳定性的回归用例：

| 维度 | 后续场景与量化目标 |
| --- | --- |
| 长对话 | 多日输入、插话、更正、偏好变更；遗漏率、事实保持、承诺生命周期 |
| 任务闭环 | 并行任务、缺材料、批准/拒绝/撤销、取消和延迟反馈；重复派发、越权次数 |
| 不确定性 | 中断、超时、缺回执、过期知识与冲突；未知效果盲重试、无证据成功声明 |
| 记忆稳定性 | 多次整理、上下文压力、重启续接；来源保留、承诺误关闭、摘要事实漂移 |
| UI 日常使用 | TUI/Web 双开、设置并发修改、通知展示、后台重连；一致性与可恢复性 |
| 统计对照 | 固定语料与模型配置，多次运行；通过率、失败分布、调用数、延迟与成本 |

未来套件应记录模型/provider、prompt版本、代码 hash、初始数据、操作授权边界、每个验收点和失败原件。用确定性断言衡量权限与状态，以人工盲审/独立评分衡量摘要与沟通质量，比较基线和趋势，不能单次跑通就宣称行为稳定。本节是计划，尚未实现完整日常回归套件。

证据层次分别为静态设计检查、OFFLINE_RUNTIME、POSTGRES_RUNTIME、LIVE_MODEL 和 REAL_USE；各层互不替代。

## 设置与 World 管理回归

`settings.test.ts` 覆盖双来源/多引用摘要、长材料分片、新输入排队、草稿持久化、版本冲突、真实 PostgreSQL 批次回滚、提交后 SIGKILL 恢复、历史时间范围与超过 100 条分页，以及运行配置切换。与 `world.test.ts` 同用测试数据库时必须串行运行；每次使用新的隔离数据库，避免不同 Store 的 outbox 混用。

```sh
SECRETARY_TEST_DATABASE_URL='<隔离测试数据库 DSN>' node --import tsx --test --test-concurrency=1 test_case/offline/runtime/*.test.ts
SECRETARY_TEST_DATABASE_URL='<另一个隔离数据库 DSN>' node --import tsx test_case/online/test-settings-live.ts <报告路径>
```

在线探针仅使用合成事实，验证更正、撤回、说明语言与旧约束承接；不代表长期真实使用。实际结果见[设置功能报告](../test_case/reports/settings-20260928/README.md)。

## 流式与思考显示验收

`streaming.test.ts` 覆盖完成前预览、SSE 认证与重连快照、关闭思考后的字段过滤、工具执行前落盘、观察回调异常、保存失败、取消、缓存边界、多调用关联、redacted 内容过滤及历史恢复。属于普通 `npm test` 的离线用例。

浏览器验收使用独立 fixture 服务与真实 Chrome：

```sh
mkdir -p .demo-data/streaming-browser test_case/reports/streaming-local
node --import tsx test_case/offline/runtime/helpers/streaming-web.ts .demo-data/streaming-browser
# 另一个终端运行，需要 Playwright 包及 Chrome；可用 PLAYWRIGHT_MODULE 指向本机包的 index.mjs
node test_case/offline/runtime/helpers/streaming-browser.mjs .demo-data/streaming-browser/browser-endpoint.json test_case/reports/streaming-local
```

服务为每段设置实际延迟，驾驶器采样完成前的正文与思考，检查四种开关组合、默认值、刷新持久化、字号、折叠和窄屏，并生成仅含合成内容的截图。完成后终止该 fixture 进程。普通 fixture 回复可能一次完成，不应以打字动画作为流式证据。

有界 live 探针：

```sh
node --import tsx test_case/online/test-streaming-live.ts <指标报告路径>
```

此探针读取本机 main 凭据，创建独立 Store，发送一次合成无工具请求；任务角色使用 fixture，结果检查没有新增任务或 Operation。报告只保存时间、状态与字符数，不保存 token 或思考原文。模型未返回可见思考时按实际记录，不能以 fixture 代替 LIVE_MODEL 结果。当前交付证据见[流式显示验收](../test_case/reports/streaming-20260929/README.md)。

## 任务复用验收

```sh
npm run test:task-reuse
npm run test:task-reuse:live -- deepseek-v4.1-flash
```

离线套件纳入 npm test，覆盖 A01–A15 的工具入口、快照、幂等、产物、授权、周期、留存和旧 journal 兼容；helpers/task-reuse-crash.ts 在受理前后、创建前后、分派后、Host 工具返回落盘前执行真实 SIGKILL，再核对持久恢复。故障与首次失败记录见[本轮报告](../test_case/reports/task-reuse-20260929/README.md)。

在线入口按 O01–O06 使用真实主会话与任务模型，不向输入注入 task ID 或工具选择。每角色最多 48 次调用、100 次工具调用、总计 12 分钟、每次模型请求 60 秒；只批准隔离 workspace 内 report.md / separate-delivery.md 的 file.write。保留首次失败，未执行用例不能登记为通过。语言内容与真实文件检查只证明本组明确场景，不代表一般语义归并能力。
