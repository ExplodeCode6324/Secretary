> 2026-10-10 实施记录：Master 已确认“按计划执行 Issue9，完成实现和隔离测试后汇报”。本分支进入 IMPLEMENTED / ISOLATED_TESTS_PASSED；当前协议见[同步合同](../api/v1/sync.md)，完整结果与保留失败见[验证记录](../api/v1/sync-verification.md)。下文原 PLAN_ONLY 状态仅记录规划时点。
>
> 实施细化：快照采用固定水位的资源版本目录和有界续页，完整资源内容由明确的当前查询加载；不声称未加载内容属于原快照。旧通知通过持久切换边界区分，原对象零重写；未路由新意图用独立、每批最多100条的 claim 命令领取。SSE 用持久位置轮询避免依赖内存发布；World 增加事务版本时钟及独立代次。没有新增 UI、旧协议兼容、生产迁移或设备操作。

# Issue #9：持久同步与多端通知回执计划

日期：2026-10-10。状态：**PLAN_ONLY / WAITING_FOR_MASTER_APPROVAL / NOT_IMPLEMENTED / NOT_TESTED**。

关联：[Issue #9](https://github.com/ExplodeCode6324/Secretary/issues/9)、[总路线 #7](https://github.com/ExplodeCode6324/Secretary/issues/7)、[阶段1 #8](https://github.com/ExplodeCode6324/Secretary/issues/8)、[客户端设计 v0.3](../native-client-design-v0.3.md)。

Master 本轮要求“领取 Issue9，写好 fix 计划，我确认后执行”。当前只做源码/依赖核对、领取、独立分支与计划文档；**业务代码、合同生成、业务测试均待明确确认**。本计划获准实施后的默认验证限合成数据、fixture 模型和隔离数据库；不包含生产迁移/部署、真实模型请求、Portable/其他设备操作或公网暴露。

## 1. 基线与依赖核实

- 实际仓库为 `ExplodeCode6324/Secretary`；本地旧 Secretary 目录已更名，实际 Core 工作目录已核验。
- 远端 main 与计划起点：`9623095a34f01933feeb74995dbb4d49edc8300e`。
- [PR #15](https://github.com/ExplodeCode6324/Secretary/pull/15) 已于 2026-10-10 合并；合入 head 为 `7974dd24b17929b853a8f3781c510e15ced18a8f`。#8 仍 OPEN，正文和部分文档仍留有待审文字；以前置代码已合入为事实，不据旧状态文字重复实现 #8，也不代为关闭 #8。
- 分支：`codex/issue9-durable-sync`。从远端 main 建独立 worktree，不修改其他分支的未提交文件、原始报告或运行数据。
- #9 正文核对版本：`updatedAt=2026-10-09T19:10:54Z`（领取前）；正文的 `dcc2f44` 源码证据属于旧基线，实施范围以下述当前源码为准。
- 开工前再核对远端 main、#9 正文及关联 API 合同，冻结提交、合同/关键源码 SHA-256 和基线检查首次结果。若有业务漂移，先更新影响分析，不自动覆盖其他工作。

## 2. 当前实现与本阶段缺口

| 当前源码/合同 | 已有能力 | 本阶段工作 |
| --- | --- | --- |
| [API 文档](../api/v1/README.md)、[api-v1.ts](../../src/pi_secretary/src/api-v1.ts) | API v1、loopback owner 认证、纯 GET、无 TerminalController 依赖 | 新增版本化 bootstrap/catch-up/SSE/通知回执；当前新版服务没有旧 SSE 可直接沿用 |
| [application-service.ts](../../src/pi_secretary/src/application-service.ts) | CoreIdentity、ClientRegistration、ApiCommand、受理/对账、公开资源 DTO 与索引 | 复用服务/身份/幂等；新增同步投影与可信目标绑定，不再造命令分发器 |
| [store.ts](../../src/pi_secretary/src/store.ts) | 同事务对象/日志/receipt；sequence、digest 链和重放；projectionFrames 含 mutations 与 log_records | 持久 cursor 必须用事务序号；补只读历史摘要索引，覆盖 records-only 事务；不得只订阅日志 |
| [timeline.ts](../../src/pi_secretary/src/timeline.ts)、[activity-history.ts](../../src/pi_secretary/src/activity-history.ts) | 显示分页、当前预览与历史活动投影 | 保留显示游标；新同步游标独立。显示排序/进程 generation 不承担持久补发 |
| [world.ts](../../src/pi_secretary/src/world.ts) | audit_outbox、稳定 event_id、导出去重；slot/catalog/browse 已用 REPEATABLE READ 及 world_version | 复用一致读，补分域 bootstrap、版本覆盖审计、导出积压/失败可见性和恢复验证 |
| [host.ts](../../src/pi_secretary/src/host.ts)、[内部合同](../../src/contracts/contracts.schema.json) | MasterInteract 原子保存 Notification + notification.queued；仍是全局 QUEUED/SENT 模型 | 内容/意图与每目标 Delivery 分离，新增明确 ACK 和迁移；不让读取或 socket 写入改变投递事实 |
| [memory.ts](../../src/pi_secretary/src/memory.ts)、host.ts 摘要输入 | 狭义结果汇报承诺依赖 notification.result、SENT 和 presented=true 的证据 | 新版 presented 证据贯通现有校验，保留旧证据；received/read 不得伪造旧 SENT |

复杂度：高。难点是事务边界、跨进程恢复、目标独立回执、World 双存储窗口及现有证据语义，不是 SSE 编码本身。

## 3. 交付与不变量

1. 一个 Master、一个权威主会话；客户端退出、慢读或断线不暂停 Core/任务，不创建各端主会话。
2. journal 为 Core 事实权威，PostgreSQL 为 World 权威；ChangeFeed 为确定性、可重建公开投影，不引入第二套消息权威日志或 MQ。
3. 持久变更至少一次投递；客户端应用/缓存与 cursor 原子保存。重复网络投递允许，业务执行、通知提醒与 ACK 可去重。
4. bootstrap、replay、分页、资源刷新纯读取：不新增 Input、触发模型、重放工具、续留任务、自动回答/审批/已读。
5. 复用 #8 的 owner + request_id 命名空间及原参数绑定，不改为按连接 ID 隔离的另一套幂等机制；accepted 与执行成功分开，UNKNOWN 不自动重跑。
6. 仅新版协议。旧 Web/TUI 路由不恢复、也不建设长期兼容层；SwiftUI 页面、新 TUI、APNs 等系统推送、远程设备配对/执行器与高频 telemetry 不在本期。
7. 对外只给白名单 DTO/资源引用及版本，不透传 CAS 路径、内部 Context、模型原始响应、凭据或内部完整 Store 记录。

## 4. ChangeFeed 与持久游标

### 4.1 投影来源与资源覆盖

从已校验并提交的 JournalTransaction 按 sequence 增量消费 mutations、log_records，并提取需要的命令关联。现有 projectionFrames 不含 digest/txn_id/receipts，实施时增加只读元数据或专用投影访问器，不改持久事务的原子语义。旧域 CommandReceipt 与新版 ApiCommand 区分；公开对账权威继续是 #8 的入口。

| 资源范围 | 来源与投影 |
| --- | --- |
| 主会话、输入、最终消息 | Session/Input mutations 和持久 message/input 日志；最终消息沿用稳定 message_id/call_id |
| 任务、执行、请求、结果 | TaskPlan/Execution/TaskRequest/TaskResult；同时失效产物目录、相关资源索引与活动投影 |
| 审批、普通决定、待处理 | 原 AuthorizationRequest/DecisionRequest/Operation 状态；attention 派生失效，保留 as_of/valid_until |
| 显示名、记忆、设置 | AssistantProfile、Consciousness/记忆相关作业、SettingsDraft/Application 等；公开摘要/承诺/来源与更新状态一起收敛 |
| 通知与投递 | Notification、Delivery 和明确回执；按目标与当前权限过滤 |
| 命令受理/进展 | ApiCommand revision、request_id 和公开 resource_ids；关联当前领域状态查询，不宣称受理就是效果完成 |
| World | 既有 outbox 导出的稳定 event_id；发出分域失效/刷新提示，不能以 journal sequence 充当 world_version |
| 权限/能力、关系变化 | 从相关权威记录派生失效；每次操作重新校验权限，客户端未知能力默认关闭动作 |

公共变化项首选 `resource.changed/resource.invalidated`（资源类型、ID、事务水位/资源 revision、关联 ID）及必要小 DTO；大文本、产物、复杂摘要只提供版本化有界读取入口。投影读取对应 mutation 的不可变 snapshot，不用当前对象冒充历史版本。迟到失效提示只促使刷新，不得把新状态降级；刷新结果与 cursor 缓存遵守各自版本。

每个持久事件有稳定身份，来源为 history + 事务位置 + 确定性项序号；固定排序和同事务去重规则。无公开变化的事务仍可产生空 checkpoint 批次，推进已检查的安全水位；不返回被过滤资源的 ID/内容。

### 4.2 Cursor 合同

单独定义同步 cursor，不能接收 #8 普通分页/Timeline cursor。内部绑定：协议/投影版本、随机且持久的 history_id、owner/session/订阅范围、已应用事务 sequence 与该位置 digest。数字对外采用十进制字符串，并拒绝超出内部安全整数范围的值。

- 新增持久 SyncMetadata 保存 history_id、投影版本及必要签名材料引用；在明确初始化/迁移事务中创建，不由 GET 懒创建。当前 CoreIdentity 的固定对象 ID 不能单独用作历史身份；复用其已持久 owner 边界，但 history 另作明确区分。
- cursor 采用有长度上限的版本化不透明编码及校验；如使用 HMAC，密钥跨正常重启稳定，受本机权限保护，不复用每次启动变化的 endpoint token。编码/签名不替代权限检查。
- 正常重启保持 history_id；cursor 的 sequence/digest 必须能在恢复后的已提交链上证明。历史替换、回退、分叉、投影不兼容、范围变化/保留窗口不可满足明确要求重同步。
- 受控恢复/迁移命令必须更新历史代次；不能承诺检测未通过恢复流程、且仍有相同公共前缀的任意外部复制。恢复手册明确此边界。
- 首期不裁剪主 journal、去重证据或 Delivery；预留 minimum_available_cursor。未来清理必须先定义 tombstone/resync，不能静默跳到最新。

格式/签名非法返回 `INVALID_SYNC_CURSOR`；有效但不可满足返回 `RESYNC_REQUIRED`（reason、重新 bootstrap 的入口）。权限问题返回 401/403，不暴露资源。流建立前正常 HTTP 错误；建立后发控制事件并关闭，不为失败分配可前进的持久 id。

### 4.3 事务边界与大小

首选一事务一批；初始上限拟为单响应 100 个事务或 512 KiB（按 UTF-8 编码测量），单连接待写缓冲 512 KiB。具体预算写入公开 schema 和测试。

过大事务拆为确定性片段：`transaction_id/index/final`，一个应用事务内暂存完整片段后统一应用。非 final 片段不产生新的 SSE id；final 才携带完成 cursor。断线后从上一个完整事务重发；客户端按片段身份去重，不能跳过未应用部分。客户端暂存可落本地磁盘，内存保持有界。单项过大改用有界资源引用，不截断原文或无限扩大缓冲。

## 5. Bootstrap、分页和两域水位

新增只读 journal 视图访问器：在单 writer 的同步边界捕获 sequence=S、digest 及不可变记录/投影引用，完成有界快照；在 capture 期间不 await、不复用带业务副作用的方法。序列化和 World 异步查询基于已冻结视图，不再读取当前活对象来拼装声称位于 S 的结果。

bootstrap 包含唯一 session、显示配置、输入/活动与待处理摘要、设置/记忆状态、通知摘要、各集合第一页或分页入口及 journal cursor=S。按需延迟加载的集合必须明确为“查询入口”，不能宣称已在快照中完整包含。快照分页绑定 S/范围并读取相同历史视图；采用有界共享引用缓存/可重建索引，过期返回 SNAPSHOT_EXPIRED，不能混拼新页面。单响应有条数/字节上限，禁止加载全历史正文。

World 独立返回 `world_version`、查询时刻、目录/事实分页入口、availability/export_state，Settings 关联 application_id 与应用状态；不声称 journal/World 跨库原子一致。数据库请求失败或超时可返回 journal 成功与 World 明确 unavailable，不能用空数组表示成功。

现有 World 查询已在 REPEATABLE READ 内同时读版本和数据，本期复用并审计其覆盖范围：`count(wm.change_receipt)` 必须覆盖所有受支持的实体/谓词/来源/事实写入。若目录初始化或其他写入绕过该版本，补统一事务内版本机制与迁移；不能在已发现漏口时继续声称版本完整。World 数据恢复还需独立数据代次，不能仅凭恢复后碰巧相等的 count 判断同一历史。

正常分页必须匹配 world_version；变更后重取，不混版。journal 已捕获 S 后数据库出现新值是允许的跨域进度；附明确状态，随后稳定 outbox 事件推动收敛。旧 World 事件仅触发核验/刷新，不能覆盖更高版本。API 查询不触发 export；导出由既有后台推进/恢复负责。

## 6. SSE、catch-up 与瞬态通道

候选路由（授权后与 operations/schema/示例同时冻结）：

| 入口 | 语义 |
| --- | --- |
| `GET /api/v1/sync/bootstrap` | 有界快照、分域水位、能力与分页入口 |
| `GET /api/v1/sync/changes?after=...` | 有界持久批次、next_cursor、has_more；与 SSE 使用相同投影 |
| `GET /api/v1/sync/stream?after=...` | 从已应用 cursor 补发并实时跟随；可用 Last-Event-ID |
| `GET /api/v1/notifications` 与 `notifications/{id}` | 有界内容/历史与目标投递摘要；纯读取 |
| `GET /api/v1/deliveries` 与 `deliveries/{id}` | 当前目标的待投递及回执对账 |
| `POST /api/v1/deliveries/{id}/ack` | 原 request_id + 明确 ack_kind；走现有公共命令服务 |

`after` 与 Last-Event-ID 同时出现必须一致，否则拒绝，不静默选择一个；首次没有有效起点必须 bootstrap。Last-Event-ID 仅作为传输恢复提示，客户端明确使用“已经应用并落地”的 cursor，不能让 EventSource 自动收到的 ID 超前于本地缓存提交。

连接建立先记录/校验起点，再由一个持久 sequence 读取循环追到当前 tip，随后继续同一循环。进程内 commit 唤醒只做加速，补 bounded polling/recheck 防失唤醒；写入 append/fsync 成功而发布前崩溃不丢事件。observer 异常不得让已成功的业务提交回报失败或撤销。

保留约 5 秒心跳；遵循 write backpressure，等待 drain 时不累积无限队列。超预算/超时断开慢端，恢复从本地最后完整 cursor 开始，其他客户端及 Core 继续运行。连接数、投影缓存、快照存活数/TTL 均设上限；关闭 Core 时主动结束长连接，不能卡住停机。

瞬态事件以 `server_instance_id + call_id/activity_id + revision` 表达最新 snapshot，可合并/丢中间版本，不附持久 id，不推进同步 cursor，不逐 token fsync。重连读取当前瞬态快照；实例变化清掉旧活动显示。最终消息和结果来自持久流，依 call_id 合并避免双份正文。

## 7. 通知意图、目标与回执

### 7.1 原子投递意图与目标策略

沿用 Notification 内容/来源、delivery_key，并新增 NotificationDelivery：稳定 delivery_id、notification_id、目标 client_id/通道、创建时版本与三类可空确认事实。唯一约束为通知 + 目标 + 通道/投递代次，发送重试不生成新 delivery_id。

首期产品规则拟定为：新通知投递给创建时已登记且启用通知的本机 owner 客户端，包括离线目标。Notification 与各目标 Delivery 在同一事务保存；将创建入口收敛为 host 调用的领域通知服务，不能散落到 HTTP 或同步 GET。目标集合为空时保留明确未路由意图，首次显式启用通知的客户端可接收切换后尚未路由的通知，通过可恢复命令原子绑定目标；其后新登记目标不追发此前已路由或已完成的历史通知。

注册、重连与启用通知通过 #8 的可信 owner 命令，稳定 ClientRegistration 不等于短连接。服务端将连接绑定到已核验登记；Delivery 查询/ACK 按绑定目标检查，拒绝通过任意 body target_id 给其他端确认。当前所有端持有本机 owner 凭据，此规则提供投递隔离，不宣称是彼此敌对客户端的密码学安全边界。远程设备凭据与配对仍不在本期。

断线不删除目标或隐式确认；显式禁用只停止后续路由，已有投递保留可对账。身份/读取权限若被撤销，活跃流也须终止或重新校验后过滤，不能只在建连时检查。不以 A 读取/ACK 改变 B 的 cursor 或 Delivery。

### 7.2 ACK 语义

| 事实 | 确认条件 | 持久记录 |
| --- | --- | --- |
| created | 服务端原子保存意图 | created_at，目标/内容版本 |
| received | 目标端已将内容与 delivery_id 持久落地 | 独立 received_at 与确认来源 |
| presented | 目标端已实际展示；首期客户端应先有 received 证据 | 独立 presented_at 与确认来源 |
| read | Master 明确已读 | 独立 read_at 与确认来源 |

ACK 每次通过原公共 request_id 对账；同 ID 同参返回原结果，改 kind/目标/内容冲突。不同 request_id 重复确认同事实也不重复生成领域变化/事件，只保存必要公共受理结果。事实单调且独立，拒绝前置证据不足的 presented/read，不自动补造较早 ACK；客户端乱序时先对账补齐。采用服务端确认时间，客户端时间仅为附加来源，不作为执行权限证明。

首期不设置全局已读自动抑制其他端提醒；A 的 read 只影响 A。查询、写 socket、缓冲入队、同步 cursor 前进均不算 ACK。原生端提示提醒同样按 delivery_id 去重，测试客户端实现本地 inbox/缓存与 cursor 原子保存。

### 7.3 历史与记忆证据

历史 Notification 原对象、CAS 内容、旧 receipt 和日志不可改写/删除。迁移生成有版本的附加记录与迁移进度，分批事务、幂等可恢复：

- 旧 SENT 只保留原通道声称及证据，不升级成任何新 client 的 received/presented/read。
- 旧 QUEUED/SENDING/FAILED/DELIVERY_UNKNOWN 进入历史待核对列表，保留不确定性；默认不批量弹出。若要重新提醒，使用明确的新投递操作，而非读取历史即重发。
- 记录切换水位；切换后新通知按新目标规则投递，新客户端同步历史只展示记录。
- memory.ts 和 host.ts 摘要输入增加新版 presented 证据读取；只允许真实、持久、目标/内容/原通知相符的 presented 事实支撑已有狭义结果汇报承诺。继续核对来源先后、session、关联任务/执行/结果，普通承诺仍由原显式规则处理。received 不满足该条件；read 不自动批准、回答或关闭其他承诺。
- 旧 notification.result 校验路径只作历史证据读取，不伪造新的 SENT 来适配旧 TUI。新证据采用明确事件类型；重复 presented 和多端 presented 不重复履约，不因新版 Delivery revision 前进使已成立的证据失效。

## 8. World outbox 恢复与可观察性

继续以现有稳定 event_id 去重。验证两段窗口：SQL commit 后 journal export 前崩溃；journal 已写而 exported_at 尚未更新时崩溃。恢复补导出或补记导出状态，不重复业务修改/通知/副作用。

为导出提供有界批次、积压条数/最早时间、最后成功水位/错误码与同步状态；不输出敏感 SQL/凭据。数据库 unavailable、outbox pending、export failed 与 fully reconciled 分开，不能仅凭有 world_version 宣称导出完成。并发 export 使用现有单后台约束并补保护/测试，不把重复 event_id 的竞争当成不可恢复业务错误。

Settings apply 关联 application_id，保留未收敛跨域状态；不能为补发而重新 apply 或自动重跑 UNKNOWN。数据库恢复/历史替换要求 World 代次与 journal 恢复策略一致说明。

## 9. 修改范围与实施顺序

| 阶段 | 修改范围/交付 | 预计工程工作量 |
| --- | --- | --- |
| P0 | 重核 #8/main、冻结基线和故障矩阵，固化公共 schema/示例/错误/目标策略 | 0.5–1 人日 |
| P1 | store.ts 只读事务元数据；新增 change-feed/sync-cursor/read-view；一致 bootstrap 与快照分页 | 2–3 人日 |
| P2 | api-v1.ts/application-service.ts 接入同步服务、catch-up/live、背压、瞬态和能力；core-client 增加 typed 接口 | 1–2 人日 |
| P3 | notification 服务/Delivery/ACK、可信目标绑定、历史转换、host/memory 证据接入 | 2–3 人日 |
| P4 | world.ts 版本覆盖补齐（如需）、分域 bootstrap、outbox 对账与恢复可见性 | 1–2 人日 |
| P5 | 跨进程/双客户端/数据库故障注入、既有回归、生成物/文档与交付审查 | 2.5–3 人日 |

总计约 **9–14 人日**，是以前置 #8 已合入为基础的工程估算，不是承诺墙钟时间。新增数据库版本迁移若超出已列的补齐范围，先修订计划。

源合同只修改 `src/contracts/contracts.schema.json`、`src/state_machine/catalog.json` 及 `docs/api/v1/schema.json` 等源文件，再由仓库脚本生成类型/OpenAPI/示例；不手改生成文件。文档同步更新 API、架构/持久化、运行恢复和测试说明。拟新增离线套件 `test_case/offline/issue9/`，复用 #8 的真实 Store、HTTP 客户端、fixture 模型与进程 crash helper，避免只 mock 返回形状。

## 10. 冻结测试与验收矩阵（当前未运行）

授权后先在未改业务代码的基线执行类型、runtime、API 和必要记忆回归，保存命令、环境版本、哈希、首次失败与跳过原因。新增失败窗口断言先在旧实现确认不支持/失败，再在新实现跑相同断言；不通过放宽预算、删断言或把缺数据库标为通过获得全绿。

| 编号 | 验收场景 | 必须证明 |
| --- | --- | --- |
| S01 | records-only、logs-only、混合/receipt-only/无公开项事务 | 必需资源无遗漏；水位可安全前进；不暴露内部项 |
| S02 | 捕获快照同时提交；快照后建连前提交；快照分页中途变更 | S 与已包含状态一致，之后变化补齐，不混页 |
| S03 | catch-up 最后一批与实时切换时提交；丢唤醒 | 持久连续，无间隙；重复可去重 |
| S04 | fsync 后发布前杀进程；正常 Core/client OS 进程重启 | 相同 history/cursor 恢复；临时 instance 显示重置 |
| S05 | cursor 篡改、范围/身份/版本不符、未来水位、回退/分叉/恢复 | 明确错误或 resync；不静默跳过、不越权 |
| S06 | 大事务多片段、片段中断、中文/emoji/长正文 | 完整事务才推进 cursor；限额有效，拼接无丢失 |
| S07 | A/B 不同 cursor、A 慢读/断开与大量提交 | B 与任务继续；连接缓冲/索引缓存有界；A 可补齐 |
| S08 | 高频 preview/心跳、最终消息落盘、Core 停机 | 不逐 token 写 journal，不重复最终正文，SSE 不阻塞停机 |
| S09 | 认证失效/目标禁用、重连换目标、未知能力与缓存旧动作 | 流及查询按当前权限过滤，撤销后停止继续投递；旧缓存不授予操作权限 |
| C01 | 消息/任务/审批/决定/Settings 响应丢失、并发重投、跨进程对账 | 原 request_id 对应单次受理与效果；变更可追踪；UNKNOWN 不重发 |
| C02 | 同 ID 改参数/审批绑定，CAS/deadline 到期/权限失效 | 冲突/拒绝正确；attention 到期无事务也重校验 |
| N01 | 写 socket 后丢响应/目标未落地；目标收到但 ACK 丢失 | 不虚报 received/presented；相同 delivery 可恢复 |
| N02 | ACK 已 fsync 响应丢失、重复/乱序 ACK、A 给 B ACK | 可对账、单调且不重复；拒绝错目标，不改变 B 状态 |
| N03 | 多端独立展示/已读、无目标创建、启用/禁用/新注册 | 目标规则确定、原子可恢复、历史不群发 |
| N04 | 旧各状态迁移中崩溃/重复迁移 | 原证据完整、无伪造 ACK、默认不重弹历史 |
| N05 | 新 presented 与旧历史证据驱动狭义汇报承诺 | received 不履约、错误任务/来源不履约、多端/重复不重复履约 |
| W01 | SQL commit 后未 export 崩溃；export 后未标记崩溃 | 稳定事件补齐、重复导出无重复效果 |
| W02 | World 并发编辑/bootstrap/翻页/恢复代次变化 | 数据与独立版本一致、旧提示不覆盖新值、跨域状态真实 |
| W03 | 数据库离线、积压、故障恢复、目录/事实各类写入 | 故障不伪报空；版本覆盖完整，导出恢复可见 |
| V01 | 名称/记忆/产物/关联/待处理跨客户端变化与重启 | 有界收敛、actor 不变、无隐式授权/已读 |
| R01 | 反复 bootstrap/replay/query，含待处理输入/通知/任务 | 除既有后台推进外，读取增量为零；隔离计数证明不新增模型/输入/留存变化 |
| R02 | 同一主会话、授权绑定、记忆来源、最终响应先保存再执行工具 | 既有保护不回退；保留完整历史证据 |

计划命令：`npm run check`、`npm test`、`npm run test:api`、拟新增 `npm run test:sync`、`npm run test:issue5`，以及实际受影响的 Issue2–5/审计定向套件；World 用全新隔离 PostgreSQL 数据库和 `SECRETARY_TEST_DATABASE_URL`，必须真正执行 W01–W03，不能仅接受条件 skip。合同生成后检查无漂移；Swift 合成 DTO 解码样例验证协议可读，不代表 SwiftUI 验收。

数据库不可用时报告该项未验证，不能关闭 Issue。性能验收记录负载/消息大小/连接数、峰值缓冲和恢复结果；不以偶然短时跑通代替慢端/分页边界。文档错误区分基线与新增；历史记忆中的检查数量不是本轮结果。

## 11. 数据迁移、回退与交付门槛

开发和验证只在合成、可丢弃隔离目录及数据库完成。生产切换另行由 Master 授权：停止唯一 writer，备份完整 journal/CAS/相关身份材料与配套数据库，记录代码/合同版本及散列，先在隔离副本验证。

迁移为显式版本化命令：预检、分批/断点、完成标记、只读校验；未完成时新同步能力返回不可用，不在 GET 隐式推进。历史来源未知保留未知，不补造 client/device 身份。新记录可能不被旧运行时识别，不能把旧代码直接指向已升级目录。

回退恢复已核验的代码、数据和配套数据库/历史代次；先对账切换后外部副作用，保持 UNKNOWN，不让备份恢复重新执行。恢复后让旧 cursor 明确重同步。不得删掉旧 journal/CAS/receipts 来“解决兼容”。

交付报告给出：实现提交及计划偏差、源合同/生成物、持久 cursor 构成、公开投影覆盖表、bootstrap 一致性证明、ACK 和迁移语义、故障矩阵逐项证据、首次失败/复跑/未验证项。公开报告仅合成样例与脱敏摘要；原始会话、运行快照、凭据、真实任务标识与本机路径不提交。

本轮仅有计划文档，未执行本节迁移或第10节任何业务测试。**等待 Master 确认本计划后，才开始 P0–P5 的代码与隔离验证；推送实现、合并、关闭 Issue 和生产切换不由本计划自动授权。**
