# Issue #8：Core 新版协议与独立应用服务计划

日期：2026-10-10。关联：[总路线 #7](https://github.com/ExplodeCode6324/Secretary/issues/7)、[实施起点 #8](https://github.com/ExplodeCode6324/Secretary/issues/8)。

状态：**PLAN_ONLY / NOT_IMPLEMENTED / NOT_TESTED / WAITING_FOR_MASTER_APPROVAL**。

本计划落实 Master 的规划修订授权及“领取首个 issue、写 fix 计划，授权后执行”的要求。本次只领取和编写文档；业务代码、合同生成、数据库变化、运行测试与部署尚未获准执行。新版 TUI 暂不做，设备访问限制不变。

## 1. 固定基线与问题

- 源码基线：`dcc2f449c3f4e227ff421712271d10da0ed6eaaf`。
- 计划基线：`d9168e08ed49aa444d05b1c66324afbea3cd691d`，在 `b5916f72134277c207e9a3a17c934c5af116e6fb` 上仅更新 README 路线。以上两次增量均为文档，未修改运行时。
- 工作分支：`codex/issue8-api-v1`。实施授权后重新记录完整 HEAD、远端 main、issue 正文摘要与文件哈希；若出现业务增量，先评估再更新计划。
- 当前 [backend.ts](../../src/pi_secretary/src/backend.ts) 为 `/api/client` 构造 TerminalController，控制与查询依赖旧文本命令、临时 client ID 和输出队列；新版 API 不能沿用该层作为业务入口。
- [scheduler.ts](../../src/pi_secretary/src/scheduler.ts) 的 `detail()` 写入留存状态；`answer()` 有局部去重但未统一通用回执，取消等入口也未统一客户端 request ID。
- [settings.ts](../../src/pi_secretary/src/settings.ts) 的 `status()` 可通过 `draft()` 懒创建记录；save/retry/restore 等仍需补齐一致的请求绑定与对账。
- [ui-client.ts](../../src/pi_secretary/src/ui-client.ts) 发现、启动后台但返回 `any`，endpoint 与 UI 名称绑定；[app.ts](../../src/pi_secretary/src/app.ts) 已有可复用的领域生命周期。

本轮只完成静态审查，未运行改动前基线测试；不能把已有历史测试报告当成本计划的验证结果。

## 2. 交付与边界

交付新版 API v1、薄应用服务、版本化 DTO、统一命令受理与对账、纯查询、Core 独立生命周期，以及针对这些变化的验证。

- Core 继续保存唯一主会话、任务、授权、Settings 和记忆权威状态；不重写 Host/Scheduler，不另造业务状态机。
- 新版 HTTP 服务不导入或实例化 TerminalController，不注册旧 `/api/command`、`/api/poll`、`/api/client` 等旧 UI 协议。旧入口调用明确失败，不自动转换为新版动作。
- 公共 DTO 与内部存储合同分开；新版字段、错误、游标、回执不受旧 TUI/WebUI 兼容约束。
- Web 静态资产与旧客户端源码的最终清理归 #10；本阶段可使其与新版 Core 不兼容，不为它们补适配器。未来 TUI 只作为 README 路线项，必须使用新版协议。
- #9 负责持久 ChangeFeed、bootstrap、水位、可靠 SSE 与多端通知回执；本阶段只定义它需要的身份、资源版本、关联 ID 与接入边界，不提前实现第二套事件总线。
- #10 负责原生基础界面；#11–#13 负责设备接入、EVENT 与远程工具；#14 承接设备模拟展示。附件首期只读已有产物，不新增上传或多模态管线。
- 既有审批、来源保留、记忆恢复 binding、未知副作用停止等领域保障继续生效。

## 3. 拟修改模块

| 模块 | 拟定变化 |
| --- | --- |
| `src/pi_secretary/src/application-service.ts`（新增） | 可信 principal、校验后命令/查询编排、公开结果投影；调用现有领域对象 |
| `src/pi_secretary/src/api-v1.ts`（新增） | 仅承载 HTTP 方法/路径、schema 校验、统一错误与认证映射 |
| `src/pi_secretary/src/api/`（新增） | DTO/schema 校验及投影，不暴露 Store 对象图和 CAS 路径 |
| `src/pi_secretary/src/backend.ts`、`app.ts` | 改为无 UI 的 Core 服务装配与后台推进；初始化只读接口所需的持久基础记录 |
| `host.ts`、`scheduler.ts`、`authorization.ts`、`settings.ts` | 窄范围补齐幂等回执和纯查询；不改变任务接续、审批或记忆提取规则 |
| `world.ts` | 有界目录/事实查询、精确槽查询、查询版本；复用既有 SQL 事务与 outbox |
| `core-client.ts`、`core-cli.ts`（拟新增） | typed API 调用、发现/附着、启动/健康/停止；不是交互式 TUI |
| `package.json`、运行文档 | 增加明确 Core 生命周期命令；阶段3完成默认 SwiftUI 入口切换 |
| `docs/api/v1/`（拟新增） | 公开 schema、操作表、错误、合成样例与版本策略 |
| 既有内部 schema 与生成脚本 | 仅在持久回执/受理意图确需扩展时修改源 schema，再生成类型；禁止手改生成文件 |

新增文件名可以在不改变职责和验收的前提下调整；实际变更清单与理由须记录在报告中。

## 4. API v1 操作草案

以下路径是实施设计输入，尚未注册为运行接口。授权后先将完整字段、错误和例子写入 schema，再实现；冻结 DTO 后供后续 Swift 客户端使用。

| 操作 | 路径草案 | 主要语义 |
| --- | --- | --- |
| Core 状态 | `GET /api/v1/core` | API 版本、能力、稳定数据域身份、进程实例、唯一 session、运行状态 |
| 连接登记 | `POST /api/v1/clients` | owner 认证后登记稳定客户端身份；连接实例与身份分开 |
| 主会话/记忆 | `GET /api/v1/session`、`GET /api/v1/memory` | 有界公开状态，不读取即触发模型 |
| 消息提交 | `POST /api/v1/messages` | request_id、文本；返回受理回执与 input ID |
| 时间线/活动 | `GET /api/v1/timeline`、`GET /api/v1/activities/{id}` | 有界读模型、稳定逻辑消息关联、活动详情 |
| 正文分片 | `GET /api/v1/messages/{id}/content` | 不透明分页游标、内容版本、UTF-8 JSON 完整文本片段，不向 Swift 暴露 JS 字符串偏移 |
| 任务查询 | `GET /api/v1/tasks`、`GET /api/v1/tasks/{id}`、`GET /api/v1/executions/{id}` | 分页、要求、接续条件、结果/局限/待执行请求；不续留 |
| 任务命令 | `POST /api/v1/task-requests`、`POST /api/v1/task-requests/{id}/cancel` | 沿用 reuse_task_id、parent、继承和未分派请求取消语义 |
| 执行控制 | `POST /api/v1/executions/{id}/cancel`、`POST /api/v1/executions/{id}/viewed` | 取消申请与终结区分；显式访问才延长热保留 |
| 工作决定 | `GET /api/v1/decisions`、`GET /api/v1/decisions/{id}`、`POST /api/v1/decisions/{id}/answer` | 回答类型、deadline、执行状态与原 request ID 绑定 |
| 审批 | `GET /api/v1/authorizations`、`GET /api/v1/authorizations/{id}`、`POST /api/v1/authorizations/{id}/decision` | 完整展示、approve/reject/revoke；保留 revision、display_hash 与最终 gate |
| Settings | `GET /api/v1/settings`、`POST /api/v1/settings/draft`、`POST /api/v1/settings/apply` | 共享草稿 CAS、公开有效状态、持久受理应用 |
| Settings 恢复 | `POST /api/v1/settings/applications/{id}/retry`、`POST /api/v1/settings/applications/{id}/restore-draft` | 普通重试不越过记忆提取恢复授权 |
| World | `GET /api/v1/world/catalog`、`GET /api/v1/world/facts`、`GET /api/v1/world/slot` | 所有集合有界；slot 用 subject/predicate/scope 精确查询并返回版本，World 更改经 Settings 草稿/apply |
| 维护 | `POST /api/v1/session/compact`、`POST /api/v1/session/resume`、`POST /api/v1/memory/commitments/{id}/resolve` | 显式管理命令，沿用已有整理、恢复和承诺规则 |
| 记忆提取恢复 | `GET /api/v1/memory/recovery`、`POST /api/v1/memory/recovery` | 原完整 preflight binding、一次授权与旧批次对账，不简化为裸重试 |
| 产物 | `GET /api/v1/artifacts/{id}`、`GET /api/v1/artifacts/{id}/content` | 所属任务校验、metadata、内容流、不可用状态；不接受任意本机路径 |
| 对账 | `GET /api/v1/requests/{request_id}` | 返回原受理结果与资源引用；业务进度从原领域对象投影，不重新执行 |
| Core 停止 | `POST /api/v1/core/stop` | owner 管理动作；持久受理后关闭，可在后续启动对账，GET 不自动重启 |

少用的程序登记与授权规则管理先盘点现有 TUI 能力，映射为受限新版管理 API 或明确 Core 管理子命令；不扩充新的授权规则产品，不让必要能力只剩旧 TUI 入口。该映射随 schema 一并冻结并在迁移清单中逐项列明。

## 5. 身份、字段和错误

1. 首期仅本机 owner。保留 loopback 默认监听、受保护 endpoint 文件、token、Host/Origin 校验；不开放公网，不注册设备凭据。
2. principal 从服务器已验证凭据产生。正文中的 actor/role/device_id 不产生身份权限；稳定 client ID 通过已认证登记绑定，不能由连接 ID 或任意请求字段替代。
3. 分开表示稳定 Core 数据域身份、session ID、稳定 client ID 和每次启动的 server_instance_id。进程重启不更改数据域身份；不把进程实例当作幂等作用域。
4. request_id 是有长度限制的不透明字符串。统一去重作用域采用稳定 owner principal + request_id，客户端标识是来源字段；同一请求跨重连、客户端重装/恢复后仍可按原身份对账。所有命令类型共享冲突检测，防止同 ID 跨操作串用。
5. 公共版本、revision/sequence 等 可能超出安全数值范围的值采用十进制字符串；时间使用带时区的 ISO 8601。命令字段严格校验，额外敏感字段拒绝；查询响应允许新增非破坏性字段，未知枚举通过 raw/unknown 分支展示，未知命令拒绝。
6. 统一错误信封含 code、message、request_id 及必要冲突详情。至少区分 INVALID_REQUEST、UNAUTHENTICATED、FORBIDDEN、NOT_FOUND、REQUEST_CONFLICT、REVISION_CONFLICT、EXPIRED、UNSUPPORTED_VERSION、CURSOR_EXPIRED、SERVICE_UNAVAILABLE；客户端不分析中文错误文字。
7. 默认列表 limit=30，最大100；Timeline 复用既有 200条/1MiB 上限作为上界，具体分页预算进入公开 schema。正文分片不切断 Unicode 标量；客户端连接片段后保持原文，组合字符跨片也不能丢失/重复。
8. Timeline 翻页游标与 #9 持久同步游标分开命名、校验用途及投影版本。World 返回自己的 world_version；本阶段不承诺跨 PostgreSQL/journal 的原子快照。

## 6. 统一幂等与崩溃一致性

- 在认证、schema 校验之后，按规范化内容计算绑定 hash，包含协议/命令类型、目标、有效载荷、expected_revision 和审批/恢复 binding。规范化规则由 schema 固定，不能让 JSON 键顺序改变业务含义，也不能排除关键授权字段。
- 对已受理同 ID 请求，先校验绑定并返回旧受理结果；不因对象已推进而错误执行第二次。新 ID 才重新验证当前 CAS/deadline/授权。已撤销 principal 仍在最外层拒绝，不因为存在旧 receipt 绕过认证。
- 短命令的领域变化和 receipt 同事务提交；沿用 Store/领域回执，对 answer、save、restore、viewed、取消等缺口作窄改造，禁止动作后另写非原子成功缓存。NO_CHANGES 等无修改结果也应可稳定对账。
- 长命令先持久化受理意图并返回 202，由恢复逻辑关联既有任务、SettingsApplication、压缩/恢复所有者或 ModelCall 证据继续推进。新增记录只承载受理/关联，执行状态仍属于原领域对象。
- 特别验证“受理意图已提交、领域动作尚未开始”与“领域结果已提交、HTTP 响应未送达”两端的恢复。若领域已产生副作用但不能证明结果，维持 UNKNOWN，不以统一包装器重跑。
- World 写入继续复用 SQL 事务 receipt/outbox 与 Settings 协调；不得把 Store.commit 当成跨数据库事务。#9 完成 World 版本与导出事件收敛，此阶段的受理与 World 操作状态仍可分别对账。
- 首期不自动回收已受理 request ID 的去重证据。若未来需要保留期限，必须提供墓碑/过期语义，不能让已执行请求过期后重新执行。NOT_FOUND 仅表示该数据域当前没有受理证据，客户端不能据此把同一未知动作换新 ID 重发。

## 7. 纯查询与产物

- 将 Execution 详情拆为纯投影和 `viewed` 命令；RETIRED 记录不因查询或访问自动复活。
- 将 SettingsDraft 等懒初始化移到 Core 初始化或显式初始化事务；查询仅更新可重建缓存。普通读取不改变留存、通知、任务、输入或模型调用状态。
- 任务/执行 DTO 按公开白名单投影，不透传 PromptSnapshot、模型原始响应、凭据、内部 CAS 路径或整个 Store 记录。
- 产物 ID 从所属任务/结果与已收录内容引用建立受控映射；验证 task/session 权限、引用所属关系、内容长度/哈希与归档状态。拒绝 traversal、任意绝对路径和不可信符号链接绕过；大文件有界流式输出，不放入状态 JSON。
- 可复用预览读取为瞬态快照，但明确无持久补发保证；最终消息读取来自持久证据，不调用模型补预览。

## 8. 生命周期与切换

1. 将 Core serve/pump/close 与任何 UI 分离；数据目录仍由现有 owner lock 保证单 writer。
2. 两个客户端并发启动时，失败竞争者附着已验证实例；endpoint 原子写入并校验权限、数据域/模式，避免将陈旧 PID 当作健康证明。
3. 本机凭据由受保护文件加载；日志和公开 DTO 不含 token。关闭客户端只断开连接，显式 stop 才触发 Core shutdown。
4. 新协议实现先在隔离合成数据目录验证；不启动、停止或升级当前使用中的实例。
5. 历史 schema 如需变化，生成转换清单、备份校验和独立目标目录，保留原件、来源身份和未知副作用状态；禁止默认清空或原地不可逆覆盖。旧版本回退只能使用其对应备份，不能直接读取新版已写入的数据目录。
6. 部署和真实历史数据切换在实现验收后另行批准；此计划批准范围默认仅实现与隔离离线验证。

## 9. 实施顺序与验证

以下均待 Master 授权后执行，不是已完成结果。

1. **冻结基线**：记录提交、文件哈希、环境版本、现有离线检查首次结果与继承失败。初始化固定依赖只用于隔离开发；不读取本地真实凭据或设备日志。
2. **合同与接口盘点**：完成上述操作字段、错误、身份、管理能力映射及 TS/Swift 可解析合成样例。复核跨 #9/#10/#11 的 ID、版本、cursor 边界后冻结 v1 草案。
3. **服务与生命周期拆分**：新 Core 启动、认证上下文、纯查询、无 UI pump；新路由不依赖旧 TerminalController。
4. **命令可靠性**：逐个补齐短命令 receipt 与长命令受理/恢复；真实 Store/journal 故障窗口测试先复现再修复，保留首次失败。
5. **读模型和产物**：分页、World 精确槽、Timeline/Unicode 分片、路径与权限控制；多客户端与查询无副作用验证。
6. **切换与回归**：去除新版服务中的旧路由，验证明确拒绝；文档与生命周期命令更新。旧 UI 专属测试退出新版兼容验收，但须逐项记录其领域保障迁移到哪个新 API 测试，不能仅删除失败断言获取全绿。
7. **汇报**：按固定提交记录命令、首次失败、修复后结果、跳过/未测及授权边界，提交实现 PR 供复核；不自动部署或关闭 issue。

| 验收组 | 必须覆盖 |
| --- | --- |
| 无 UI 运行 | 直接启动、双客户端同 session、客户端退出后已受理工作继续、并发启动单 writer、stop/重启对账 |
| 幂等 | 相同 ID 并发重投、响应丢失、重启、跨操作同 ID、改参、NO_CHANGES；仅一个业务效果 |
| 长命令恢复 | 受理后未开始崩溃、开始后结果未知、结果已保存未回响应；不重做未知副作用 |
| 审批/记忆 | 旧 revision、改 display_hash、过期绑定、草稿冲突、普通 retry 越权拒绝；原 recovery 证据不弱化 |
| 查询 | 隔离后台推进后重复读取，业务 revision、留存、输入和模型调用不增加；显式 viewed 单独生效 |
| 数据与产物 | 分页/字节上限、中文/emoji/组合字符无损、World 精确槽、越权/任意路径拒绝、归档与丢失内容可见 |
| 新协议 | schema/TS/样例一致、错误代码、未知字段/枚举/版本处理；旧 UI 路由拒绝，不构造 TerminalController |
| 数据转换 | 需要转换的历史合成 fixture 保留来源、证据与 UNKNOWN；备份可校验，不能用旧 writer 打开新数据 |

验证命令按最终文件清单细化：`npm run check`、`npm run types:generate`（仅内部 schema 改动时）、公开 DTO 校验、相关 runtime/Issue 2–5 离线用例、隔离 PostgreSQL 的 Settings/World 用例，以及 `npm run docs:generate` / `npm run docs:check` 的基线比较。必要回归通过后不无理由重复长测试。

源码中仍有旧 UI 测试入口，当前 `npm test` 不等于未来新版验收清单；实施时在报告记录旧用例处置和等价保障映射。真实模型冒烟、安装客户端、部署和设备测试不在本次默认授权范围；需要时先列最小场景与调用边界再报 Master。

## 10. 估算与批准对象

#8 原估算为 6–10 人日，作为接口整理的量级参考；取消 TUI 适配后，仍须承担全操作幂等、长命令恢复和旧数据转换验证。基线与合同盘点若发现超出此范围的领域改动，应更新计划与估算后复核。

本计划请求批准的下一步是 **#8 的业务实现、合成数据下的离线故障验证与必要隔离 PostgreSQL 回归**。不含真实模型调用、运行实例切换、生产数据迁移、设备访问、TUI/SwiftUI 开发或后续阶段实现。
