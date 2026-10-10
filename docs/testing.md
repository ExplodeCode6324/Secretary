# 测试策略

当前测试入口以 package.json 和代码为准。以下命令不会调用真实模型；数据库套件须使用新建隔离库，历史报告不等于当前代码重新通过。

```sh
npm run verify
npm run test:issue5
node --import tsx --test test_case/offline/issue2/*.test.ts test_case/offline/issue3/*.test.ts test_case/offline/issue4/*.test.ts
npm run test:review
npm run docs:generate
npm run api:generate
npm run docs:check
```

## 当前自动回归

| 套件 | 当前范围与边界 |
| --- | --- |
| npm run check | 主源码、scripts/*.ts、runtime、issue5、issue8、issue9 和 online TypeScript；Issue 2–4 不在默认 tsconfig include |
| npm test | runtime：Store、Host、Scheduler、授权、shell、记忆、设置及读投影；含保留的纯 TUI/DOM 单元测试 |
| npm run test:sync | issue9：真实 journal/HTTP/SSE、跨进程 SIGKILL、双端投递、分片/慢端、World SQL/export 窗口与记忆展示证据；数据库项需隔离 DSN |
| npm run test:api | issue8：认证/幂等/旧请求身份冲突、纯查询/viewed、Core 生命周期、Unicode/游标、任务/产物/待处理、World 时间/schema 与外部 DTO 消费 |
| npm run verify | check + npm test + test:api + test:sync；不包含 Issue 2–5 全部专项、review 或真实模型 |
| npm run test:issue5 | 空提取、证据匹配、设置后原文跨压缩/重启进入实际 stream；fixture 不评价真实模型长期记忆质量 |
| Issue 2–4 专项 | 请求容量/来源、承诺证据、提取恢复、期限与中断保护；另做 strict 类型检查 |
| npm run test:review | 额外审计，明确排除历史误报 AUD14；不是“所有历史探针全部通过” |

旧 UI 三项断言显式 skip：dual-ui 的旧 TUI 双进程、web 的旧双 UI 合同、web-render 的旧静态路由。领域和安全 DOM 测试仍运行；新版生命周期/协议由 issue8 替代，不能把跳过项说成新版界面已测。数据库测试缺少 SECRETARY_TEST_DATABASE_URL 时另有条件跳过，必须单列。

`streaming.test.ts` 当前覆盖内存预览、API v1 timeline 的 streaming/thinking 投影、响应持久化先于工具、取消/失败、字段过滤和重开恢复；不再证明旧 SSE 可用。activity/history/timeline 测试保留读模型、稳定身份与分页断言，并转用 API v1。实例与游标变化、attention 到期无需 journal 变化的复核由 issue8 覆盖。

## PostgreSQL

```sh
python3 test_case/offline/test-postgres.py --pg-bin /path/to/postgresql/bin
python3 test_case/offline/audit/run-world.py --pg-bin /path/to/postgresql/bin
# 以下 DSN 必须指向新的隔离数据库；此命令补充 API v1 的数据库合同验收。
SECRETARY_TEST_DATABASE_URL='<隔离测试 DSN>' node --import tsx --test --test-concurrency=1 test_case/offline/issue8/world.test.ts
```

test-postgres.py 创建临时 Unix socket 集群，只运行 runtime/settings.test.ts 和 world.test.ts，结束停止并清理，不包括 issue8 的 PG 用例。不同套件不得复用已有合成 outbox/source_key 作为新基线，也不连接应用数据库。Settings 覆盖原子回滚、提交后恢复、分页和配置切换；API 专项实际验证 PostgreSQL 日期 ISO 投影、合法 predicate JSON Schema 原样保留与 CAS 元数据隔离。

## API、合同和文档验证

`api:generate` 从公开 schema/operations 生成 OpenAPI 与 TS DTO；外部消费者回归导入所有公开命名定义及各操作类型。Swift 的合成解码示例在 docs/api/v1；它不构成 SwiftUI 验收。`docs:generate` 从运行 schema/SQL 生成内部字段与数据库文档，不能手工维护生成页后让下次生成覆盖修订。

文档检查核对本地链接和迁移目的地，不证明运行行为。当前资料可用性见[仓库说明](repository-layout.md)与[缺失附件清单](unavailable-evidence.json)。不放宽检查器来掩盖错误，不创建虚假的报告让链接变绿。

## 显式 online

真实调用会消耗 provider 配额，必须在明确场景和预算内运行，使用新建私密合成目录，保留源码散列、首次失败和实际 HTTP 尝试数。入口和参数见 [online README](../test_case/online/README.md)。普通 npm test 不运行 online。

| 场景 | 覆盖与限制 |
| --- | --- |
| test-api-v1-artifacts-live.ts | 真实 write/bash/read、同任务两轮、API 四件产物、回执与独立字节/程序验算；精确程序许可，不评价通用编程能力 |
| test-api-v1-live.ts --scenario task-chain | 历史 summary-only 数值和执行关系；无产物，不能当作工具验收 |
| test-api-v1-live.ts --scenario memory-restart | 真实整理后退出旧 OS 进程，新 PID/Core instance 打开同一 Store 并真实回忆；原事实仍在请求上下文 |
| test-task-reuse-live.ts | 原 O01–O06 多轮任务；受限报告文件写入、不可变产物和接续，不执行 shell；旧证据保留 |
| test-live.ts | chain/missing/unknown/transport/reject；场景限定许可与受限程序 oracle；原故障注入不是 provider 自然故障 |
| test-instructions-live.ts / test-settings-live.ts / verify-memory-live.ts | 说明、World/设置和记忆探针；有的入口改变指定隔离 Store，不用于现用数据 |

严格产物场景可先执行零模型调用自检：

```sh
node --import tsx test_case/online/test-api-v1-artifacts-live.ts --self-check
```

真实模式须按 online README 配置已有凭据，再显式 `--live --evidence <全新私密目录>`；每轮最多12次实际HTTP/600秒，单次90秒/4096输出token/80000bytes上下文，至少20秒请求开始间隔。失败或未知作用不静默重发；用 API 下载内容独立验算，不匹配模型 summary 代替执行。

既有合成 online 结果与失败见 [API 验证记录](api/v1/verification.md)。其产品 verified_by=NOT_VERIFIED，宿主验算为独立证据。SDK费用估算不等于账单；无usage的失败请求不按零费用计算。此次文档修订不增加真实模型调用。

## 任务复用验收

`npm run test:task-reuse` 纳入 runtime，覆盖工具入口、要求快照、幂等、产物、授权、周期、留存与旧 journal 兼容。崩溃 helper 在受理、派发及工具结果保存边界执行真实 SIGKILL；所有新任务必须使用隔离临时 Store，不重放现用未知操作。原在线多轮与新增严格 API 产物场景互补，不互相冒充全部覆盖。

## 遗留浏览器与终端探针

runtime/helpers 中的 streaming-web、activity-web、timeline-window-web、浏览器/PTY/bench 脚本以及部分早期 online UI 探针仍面向旧 UI 路由或静态页面。新版 Core 不提供这些路由，不能按历史命令直接跑出当前客户端验收；修订这些脚本或实现 SwiftUI 属于后续工作。旧截图、滚动和流式报告仅证明其原版本，在[报告索引](../test_case/reports/README.md)追溯。

保留的纯 DOM Markdown 安全回归不依赖旧 HTTP 服务。真实滚轮、选择、焦点、键盘和窗口尺寸仍应在将来的原生 UI 单独验证，不能用直接设置 scrollTop 或 fixture 服务代替真实交互。

## 证据层次与后续

静态设计检查、OFFLINE_RUNTIME、POSTGRES_RUNTIME、LIVE_MODEL、REAL_USE 互不替代。报告记录确切代码版本、配置/范围、首次失败、退出状态、未运行项；原始会话、凭据和真实运行身份保持私密，只发布脱敏汇总。

后续仍需长期对话、更正和事实保持、多次整理/模型迁移、并发任务/取消/重复命令、原生客户端断线与缓存，以及重复样本的失败分布/延迟/成本。合成逻辑日和一次成功链路不证明长期稳定性；原始输入仍在请求里时不声称“只靠摘要记住”。可靠 ChangeFeed 和原生 UI 分属 #9、#10，设备与远程执行另行验收。

## Issue #9 隔离同步验收

`SECRETARY_TEST_DATABASE_URL` 必须指向专用测试集群；Issue9 World 套件在其中另建随机临时数据库并在结束后删除，需要相应建库权限。不得用生产 DSN。新增同步套件不调用真实模型、不连接设备。失败、首次通过与覆盖限制见[同步验证记录](api/v1/sync-verification.md)。旧 streaming 回归不能替代持久游标、SIGKILL 和目标回执测试。
