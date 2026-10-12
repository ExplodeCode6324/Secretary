# 测试策略

从仓库根目录执行唯一的完整离线验收入口：

```sh
git submodule update --init --recursive
npm ci
npm run verify
```

需要 Node.js ≥ 22.19、Python 3 和固定 Pi 子模块。verify 顺序为 `check → docs:check → npm test`；任一阶段失败立即返回非零。测试只用合成 fixture，不调用真实模型。

## 当前自动回归

`npm test` 直接运行 `tsx --test "test_case/offline/**/*.test.ts"`。新增当前离线测试按 `*.test.ts` 命名即自动纳入；helper、worker、浏览器探针和 benchmark 不作为测试入口。使用 Node 原生 pass/fail/skip/todo 汇总和退出码。

- 类型检查覆盖全部 `test_case/offline/**/*.ts`，含 issue2、issue3、issue5、issue8、issue19、audit 和 helper；旧 issue4 恢复套件已退役，无临时类型排除。
- runtime、issue2、issue3、issue5、issue8、issue19、audit 及新增套件均在默认入口；定向调试可用 `npm run test:api`、`npm run test:issue5`、`npm run test:review`。
- AUD14 保留回调和断言，使用 Node 原生 todo。当前 `tools_schema` 存放 system 消息而该断言按顶层工具定义读取；#19 删除恢复哈希消费者，#24 处理字段语义及 Context 编码。todo 会执行、独立计数，不使 verify 失败。
- 三项已退役 UI 合同用例已删除：dual-ui 的旧 TUI 双进程、web 的旧双 UI 合同、web-render 的旧静态路由。领域与 Markdown DOM 安全测试保留，生命周期/协议由 issue8 覆盖。
- 历史探针位于 [historical/offline](../test_case/historical/offline/README.md)，不参与默认执行或类型检查，不随当前接口重构维护。

`streaming.test.ts` 覆盖内存预览、API v1 timeline 的 streaming/thinking 投影、响应持久化先于工具、取消/失败、字段过滤和重开恢复。activity/history/timeline 测试保留读模型、稳定身份与分页断言，并使用 API v1。

## PostgreSQL

设置 `SECRETARY_TEST_DATABASE_URL` 指向**专用测试 PostgreSQL**，角色须有 CREATEDB。CI 使用 PostgreSQL 18 service；本地可使用已有 PG 18 的专用测试连接。

```sh
SECRETARY_TEST_DATABASE_URL='<专用测试 DSN>' npm run verify
```

所有 PG 测试通过 `test_case/offline/helpers/postgres.ts` 的 `testPostgres` 注册。每个场景创建一个 `secretary_test_` 前缀的空数据库，同一场景的崩溃、重开、重试复用该库；worker 显式继承场景 DSN。helper 保持一条场景连接，在 App 关闭到重新打开的间隙也保持“使用中”。finally 只清理本次创建的库，不清空输入 DSN 所指库。

本地缺 DSN 时 PG 用例以明确原因 skip，计入 Node 汇总；CI 模式缺 DSN 时注册直接抛错。已配置 DSN 后，连接、建库或业务断言失败均按失败处理，不转为 skip。不维护固定 PG 场景数量。CI 中 PG 必须实际执行，skip 为零；AUD14 todo 单列。

中断可能留下孤儿库，使用显式手动清理入口：

```sh
# 默认仅列出候选与忙碌库
SECRETARY_TEST_DATABASE_URL='<专用测试 DSN>' npm run test:db:clean
# 确认列表后执行
SECRETARY_TEST_DATABASE_URL='<专用测试 DSN>' npm run test:db:clean -- --apply
```

仅匹配字面前缀 `secretary_test_`、当前角色所有且无活动连接的数据库，排除连接库及模板库；删除不用 FORCE，扫描后新来的连接也会阻止删除。自动清理可以强制关闭本场景库中遗留的连接。旧的两个 Python PG 入口已删除，所有场景统一使用共享 helper；Python 3 继续用于 journal 锁助手。

## GitHub Actions

`.github/workflows/verify.yml` 在 main push 和所有 PR 上运行同一个 verify：Ubuntu、Node 22、Python 3、固定 Pi 子模块、PG 18 service、npm ci。setup-node 缓存 npm 下载内容；Actions 固定提交，仓库权限只读，不提供模型凭据，不容忍 Linux verify 失败。Swift 可选 job 留到 #10。

CI 标红不等于仓库已阻止合并；main 的分支保护和 required check 由 Master 决定。PR 故障标红与 main 首次通过按实际 GitHub 运行记录验收。

## API、合同和文档验证

`api:generate` 从公开 schema/operations 生成 OpenAPI 与 TS DTO；外部消费者回归导入所有公开命名定义及各操作类型。Swift 的合成解码示例在 docs/api/v1；它不构成 SwiftUI 验收。`docs:generate` 从运行 schema/SQL 生成内部字段与数据库文档，不能手工维护生成页后让下次生成覆盖修订。

文档检查通过 `git ls-files` 枚举 README、docs 和 test_case 中受 Git 跟踪的 Markdown，核对本地链接和迁移目的地；未跟踪的本地报告不参与，新增文档须先 git add。检查不证明运行行为。当前资料可用性见[仓库说明](repository-layout.md)与[缺失附件清单](unavailable-evidence.json)。不放宽检查器来掩盖错误，不创建虚假的报告让链接变绿。

## 显式 online

真实调用会消耗 provider 配额，必须在明确场景和预算内运行，使用新建私密合成目录，保留源码散列、首次失败和实际 HTTP 尝试数。入口和参数见 [online README](../test_case/online/README.md)。普通 npm test 不运行 online。

| 场景                                                                      | 覆盖与限制                                                                                                |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| test-api-v1-artifacts-live.ts                                             | 真实 write/bash/read、同任务两轮、API 四件产物、回执与独立字节/程序验算；精确程序许可，不评价通用编程能力 |
| test-api-v1-live.ts --scenario task-chain                                 | 历史 summary-only 数值和执行关系；无产物，不能当作工具验收                                                |
| test-api-v1-live.ts --scenario memory-restart                             | 真实整理后退出旧 OS 进程，新 PID/Core instance 打开同一 Store 并真实回忆；原事实仍在请求上下文            |
| test-task-reuse-live.ts                                                   | 原 O01–O06 多轮任务；受限报告文件写入、不可变产物和接续，不执行 shell；旧证据保留                         |
| test-live.ts                                                              | chain/missing/unknown/transport/reject；场景限定许可与受限程序 oracle；原故障注入不是 provider 自然故障   |
| test-instructions-live.ts / test-settings-live.ts / verify-memory-live.ts | 说明、World/设置和记忆探针；有的入口改变指定隔离 Store，不用于现用数据                                    |

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

## Issue #19 重试验收

issue19 使用每 Store 注入的测试时钟验证三次传输、首次后再补试三轮维护及幂等重排；本地 HTTP 服务验证固定 Pi 适配器的 HTTP 状态、Retry-After 与物理发送次数。真实 SIGKILL 覆盖 MAIN 响应保存、工具响应保存、摘要和提取响应保存、传输失败写入边界。旧 ExtractionRecovery 合成 journal 保持可读；旧 issue4 中不依赖恢复票据的 journal ownership 回归迁入 issue19。

旧测试中“两次即时候选”改为跨维护轮的显式时钟推进；失败来源不再永久阻塞 Settings。来源真实性、通知回执、不能从伪造/跨会话事件完成承诺的断言继续运行，来源 owner 改为 MemoryExtractionJob。


## Issue #16 / #18 工作范围与中断恢复

`test_case/offline/issue16/` 验证 Scope owner 命令、物理根冲突/保留目录、不可变绑定、同 tick 占槽、NONE 并行、归档/接续、共享笔记授权/预算/不可信边界、CAS 和绑定根核验。主会话 fixture 验证 scope_id 选择及重试快照。真实 Core SIGKILL 加冻结 wrapper 验证清理完成前下一 DIRECTORY 程序不会启动。

`test_case/offline/issue18/` 验证四种人工裁定、幂等/冲突、同执行未知操作拦截、最后一项收束及反馈修复。shell/program 真进程覆盖门控前后、Core 死亡、wrapper 冻结和 wrapper 先退出但子进程持有管道；身份/启动标识/权限分支另用确定性 fixture。模型发送、成功响应和工具结果落盘后 SIGKILL 验证冻结请求恢复及零重复成功调用/工具。

macOS 本机执行真实进程场景，Linux 在既有 PG 18 CI 中执行同组测试；不通过重启工作站制造 boot-id 变化。不调用付费供应商，不部署。所有场景使用临时数据与合成文件；测试日志不作为公共提交。完整 verify 的 AUD14 是已有 #24 todo，仍保留；不将它计为成功。
