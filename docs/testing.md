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

套件应记录模型/provider、prompt版本、代码 hash、初始数据、操作授权边界、每个验收点和失败原件。用确定性断言衡量权限与状态，以人工盲审/独立评分衡量摘要与沟通质量，比较基线和趋势，不能单次跑通就宣称行为稳定。已有显式 [多日连续性入口](../test_case/online/README.md#多日记忆与语言连续性) 覆盖其中部分场景；完整日常回归仍未实现。

`process-lifecycle.test.ts` 用合成 OS probe 验证 Linux zombie、PID 消失与权限错误的清理判定；`dual-ui.test.ts` 验证实际双客户端关闭流程。合成 Linux 分支测试不等同于真实云环境复现。`web-render.test.ts` 验证安全 DOM、结构语法与流式前缀；浏览器视觉和交互验收另存截图与报告。

证据层次分别为静态设计检查、OFFLINE_RUNTIME、POSTGRES_RUNTIME、LIVE_MODEL 和 REAL_USE；各层互不替代。

## 设置与 World 管理回归

Issue 5 的 `npm run test:issue5` 使用合成输入和全新临时 Store，检查历史已完全覆盖时的设置应用、空提取不重复调用及不匹配证据拒绝；同时检查设置后原始 Master 输入跨压缩、重启和重复投影仍进入实际主模型 stream 请求，保持历史语义、工具配对与容量硬门禁。摘要 fixture 故意不复述原文，因此通过不依赖摘要偶然保留。此套件属于应用逻辑回归，不声称验证真实模型长期记忆质量。

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

## 当前活动验收

消息间历史活动另由 `activity-history.test.ts` 覆盖 journal/CAS 重建、工具请求与结果区分、真实等待/失败、跨重启身份、批量输入归属、分页/指定 ID 鉴权以及长对话缓存。默认性能集为 1 千活动；显式设置 `ACTIVITY_HISTORY_BENCH=1000,10000,30000` 并使用 `node --expose-gc --import tsx --test --test-name-pattern='long history' test_case/offline/runtime/activity-history.test.ts` 可重跑扩展测量。新版 Web 验收入口为 `helpers/activity-timeline-browser.mjs`，fixture 可设 `TIMELINE_HISTORY_SEED=1` 预置 80 条合成维护记录。结果与长对话限制见[第二版报告](../test_case/reports/activity-timeline-20261005/README.md)。下面保留第一版测试入口及其适用范围。

第三版窗口测试为 `timeline-window.test.ts`，覆盖混合顺序 oracle、前后分页、迟到活动、会话隔离、字节预算、无变化零正文读取、后台授权归属及旧 API。浏览器入口为 `helpers/timeline-window-browser.mjs`（默认 10 分钟持续测试）和 `helpers/timeline-window-races.mjs`（乱序、偏好切换、双客户端、文字选择、响应到可见延迟）。`helpers/timeline-window-web.ts /tmp/secretary-window-<名称>` 提供 6000 条合成记录及大正文；不得用现用数据目录。

`helpers/timeline-scroll-browser.mjs <browser-endpoint.json> <输出目录>` 使用同一隔离 fixture，专门覆盖真实小幅滚轮、键盘、自动跟随、流式期间阅读、尺寸变化与分页锚点；不能用预先设置 `follow=false` 或直接修改 `scrollTop` 替代首次滚动的回归。首次失败、修复及验收见[滚动修复报告](../test_case/reports/timeline-scroll-20261005/README.md)。

`PLAYWRIGHT_MODULE=<本机 Playwright 模块路径> node --expose-gc --import tsx test_case/offline/runtime/helpers/timeline-window-bench.ts <输出.json>` 会创建临时目录，依次生成 1 千/1 万/10 万条混合历史，各执行 100 次单客户端和 100 次四并发深页 HTTP 查询，并在真实 Chrome 中每档执行 100 次定位渲染；不配置该环境变量则只测 API。需要已安装 Chrome。首轮失败和修复后结果、冷索引与热查询边界见[第三版验收报告](../test_case/reports/timeline-window-20261005/README.md)。

`activity.test.ts` 使用真实 Host/Scheduler/Settings 与受控模型延迟，覆盖独立活动、稳定版本、跨会话过滤、无正文 SSE、设置分段/重试/承诺提取、队列去重、并行任务、授权/决定/取消、同客户端命令阻塞，以及模型/设置处理中实际 SIGKILL 后恢复。World 查询的活动边界使用受控 read fixture；真实 PostgreSQL 事务和恢复另由既有 settings/world 套件验证。

```sh
node --import tsx --test test_case/offline/runtime/activity.test.ts
# 创建新的隔离目录，再启动合成服务；结束后仅停止该 fixture 进程。
node --import tsx test_case/offline/runtime/helpers/activity-web.ts <隔离目录>
# 另一个终端：需要 Playwright（可用 PLAYWRIGHT_MODULE）与 Chrome。
node test_case/offline/runtime/helpers/activity-browser.mjs <隔离目录>/browser-endpoint.json <报告目录>
# 真实 PTY，Python 环境需要 pyte；不属于 npm test 的平台无关测试。
python3 test_case/offline/runtime/helpers/activity-pty.py <隔离目录> <PTY报告.json>
```

浏览器验证四种流式/思考组合、三项并行活动、刷新、离线事件、重连、窄屏、草稿保留和安全文本/过期版本过滤。PTY 验证中文输入、中间插字及缩放时的光标保持；测试适配器不等同于人工 Terminal.app 长期使用。

显式 `node --import tsx test_case/online/test-activity-live.ts <报告路径>` 使用真实主模型、隔离 Store 和合成输入，最多 12 次调用/15 分钟，禁止模型工具调用结果进入 Agent 执行；验证聊天、设置整理和排队恢复，不连接现用数据库。报告分别保存调用数和活动采样，不保存凭据或提示原文。见[本轮验收报告](../test_case/reports/activity-20261005/README.md)。

## Issue 4 显式提取恢复

`test_case/offline/issue4/` 使用合成模型与临时 Store，验证 request_id/hash 幂等、并发领取、配置/版本/来源绑定、未知结果停发、完整结果对账、原 owner 提交以及 TUI/HTTP 入口。完整运行方式为 `node --import tsx --test test_case/offline/issue2/*.test.ts test_case/offline/issue3/*.test.ts test_case/offline/issue4/*.test.ts`；Issue 2/3/4 测试还需单独 strict TypeScript 检查，不能只依赖默认 tsconfig 的 runtime include。

中断测试区分进程内注入与真实 SIGKILL；对授权落盘、发送前后、响应保存、提取成功、工作记忆提交窗口分别核对跨重启发送数及回执。World 相关测试仅使用新建隔离 PostgreSQL。保留 Issue 3 来源/批次/时间/任务/通知回归及 PERRI 原始跨批次探针，不能以新测试替换它们。本轮首次失败、后续结果、完整命令、版本和哈希保存在 `test_case/reports/issue4-20261006/`；是否通过以最终报告为准，不以本规范充当运行证明。

PERRI 复审后的补强覆盖：ModelCall task/execution scope、Context 缺失及 system 请求不符的损坏证据反例；5 分钟凭证过期、期限篡改、重启失效及已消费回执继续对账；Store 锁内 journal 协议和正常 owner/reopen/尾帧恢复。历史 helper 丢失故障实验被平台中止，本轮仅只读保存其既有证据，不重跑或改路径重建该实验，不据此声称已验证恢复端到端重复发送。新证据保存在 `test_case/reports/issue4-20261007/`，原报告保持不变。
