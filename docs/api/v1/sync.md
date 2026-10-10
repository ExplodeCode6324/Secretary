# 持久同步与通知回执 v1

本分支实现 Issue #9；生产启用仍须单独切换。公共字段见 [schema](schema.json)、[操作表](operations.json)、[OpenAPI](openapi.json)。唯一主会话、owner 认证、Host/Origin 检查及 [原命令对账规则](README.md)保持不变。

## 启用与身份

owner 显式提交 `POST sync/initialize`，body 为 `{request_id}`，在同一 journal 事务中保存 SyncMetadata 与 ApiCommand。初始化可重复，不扫描或改写旧通知；此前能力返回 `not_configured / SYNC_NOT_INITIALIZED`，GET 不做迁移。World 另经 `admin/world/migrate` 应用 SQL 004，再对账该长命令；不由 bootstrap 隐式迁移。

`POST clients` 仍创建稳定 ClientRegistration。`POST clients/{id}/notification-target` 的 body 为 `{request_id, enabled, rotate_binding?}`；同 owner 最多100个启用通知目标。`GET clients/{id}/notification-target` 返回该登记的 enabled 和 binding。客户端把 binding 放入 `X-Secretary-Client`，不要写入日志/公开报告。它绑定 owner、client ID、可轮换 nonce；连接实例不是目标身份。轮换使旧 binding 的查询/ACK/活跃流失效，但不删除既有 Delivery。

首期所有连接共享本机 owner 权限，owner 能登记和管理目标；binding 用于防止意外确认错端，不宣称是敌对客户端之间的安全边界。不支持远程设备 principal、配对、APNs 或公网监听。

## Bootstrap 与只读快照

`GET sync/bootstrap` 返回 `history_id/projection_version/instance_id/cursor`，以及独立的 journal 与 world 两域。

- journal 含同一同步调用边界内捕获的 session、显示名称、`as_of` 和资源版本目录第一页；cursor=S 对应该视图。`resources.next_cursor` 用 `GET sync/snapshot?cursor=...` 续读。
- 资源目录提供类型、ID、当时 revision、可用 state 和 query。它是固定 S 的版本/失效索引，不是每种资源完整内容的复制。`queries` 是另行加载的当前 API 入口，不能声称这些尚未执行的查询已经包含在 S 的快照里。
- 固定页通过已提交 mutation 的不可变引用和二分版本索引重建，绑定当时目录长度，后续新增资源不延长旧分页。每页扫描最多100个目录项；过滤后允许空页，但 next_cursor 必须继续前进。页游标5分钟过期，返回 SNAPSHOT_EXPIRED 后重新 bootstrap。
- 不按客户端持有整份历史副本/无限快照缓存。共享投影索引与 Store 重放仍随历史增长，未实现主 journal 历史回收或常数内存启动。
- 后续 query 返回的最新资源可能晚于 S：客户端按资源版本合并，失效事件仅促使刷新，旧事件不能覆盖更新的值。展示正文、产物等使用原有有界查询；不为读缓存触发模型或工具。

World 由后续独立 SQL 一致读取得 `world_version/world_history_id/as_of`，还返回 `pending_exports/oldest_pending_at/last_exported_at/export_state`。其读取时间不等于 journal S。Settings application_id 与应用状态仍通过原查询对账，不把两域标为一个原子快照。World 未配置与不可用分别返回 not_configured/unavailable；失败不是成功空列表。

SQL 004 的 sync_clock 在数据事务内由触发器递增，覆盖实体、来源、谓词、事实和 receipt 等写入；回滚也回滚版本。各 World 页绑定数据代次和版本，不再只靠 receipt 总数区分目录变化。旧事件不得将新 World 值回退。

## 持久 ChangeFeed

`GET sync/changes?after=<applied_cursor>&page=<optional_next_page>` 返回 batches、next_cursor、next_page、has_more。HTTP JSON 仍使用 `{api_version:"1",data:...}` 信封。

来源是已提交 JournalTransaction 的 mutations 与 log_records，不只依赖 OperationLog。对象-only 变更可见；最终消息事件、任务/执行/结果、审批/决定、Settings/记忆、显示名、通知/目标投递、命令受理与 World 导出均有公开资源引用或失效提示。TaskResult/执行等同时失效产物、相关资源、attention；记忆更新同时失效摘要/承诺。ApiCommand 变化携带 request_id，可通过 `requests/{id}` 查询关联领域资源与实际进度。

公开项含 `resource_type/resource_id/revision/query`，可选 state/client_id/request_id。普通资源 revision 是领域 revision；invalidation/world/message 项的 revision 是触发事务位置，不能与另一个域的资源版本混比。最终消息引用用 event ID 定位，查询返回稳定 message_id/call_id，客户端据此合并预览与最终正文。内部 Context、凭据、CAS 路径及模型原始响应不在 feed 中。

cursor 绑定协议/投影版本、持久 history_id、owner/session/目标范围、事务 sequence 与该位置 digest，并使用持久签名密钥校验。正常进程重启不使同步 cursor 失效；原 API 分页游标仍可因实例变化而失效，二者不可混用。范围/历史/投影/链位置不匹配返回 RESYNC_REQUIRED，错误 details 给 reason 和 `recovery=sync/bootstrap`；格式或签名错误为 INVALID_SYNC_CURSOR。未配置时返回 SYNC_NOT_INITIALIZED，不静默从当前 tip 开始。

事务按既定 mutation/log 顺序投影。批次身份为 history_id + sequence，片段由 index 区分；重复失效项可以合并为相同资源的刷新，不创建新业务动作。没有公开项的事务仍可返回空批次，安全推进水位。

## 分片、SSE 与背压

单页最多100个事务/片段并限制约512 KiB（内部预留 envelope/cursor 空间）。单事务每片最多100项且变化正文不超过48 KiB。超大事务分片：`transaction_id/sequence/index/final/changes/cursor`；只有 final 片段有完成 cursor。

当一页停在事务中间，next_cursor 保持上一个完整事务位置，next_page 仅用于当前事务续片，不能当成“已应用 cursor”。客户端按事务/片段去重并落地暂存，拿到 final 后原子应用完整事务与保存 cursor。中途崩溃可丢弃暂存，从最后完整 cursor 重发。HTTP 页的 cursor 本身只是服务端提供的位置，客户端未应用前不得保存为已应用。

`GET sync/stream?after=...` 返回 `text/event-stream`。可用 Last-Event-ID 代替 after；同时提供必须相同，否则 SYNC_CURSOR_CONFLICT。流内 `event: change` 的 data 是同一 SyncBatch；仅 final 发送 SSE id。客户端不能把网络库自动记录的 last-event-id 当成本地已应用位置。

补发与 live 使用同一持久位置读取循环，每100ms检查一次，无独立内存发布队列；commit 已 fsync、尚未 install/网络发布时崩溃，恢复后仍能补发。一次连接最多待写512 KiB；遵循 drain，超过5秒未排空则断开。单服务最多32条同步流；其他客户端继续工作。约5秒心跳，不产生 journal 事务。Core 停机销毁长连接，不等待无限 SSE 完成。

`event: transient` 返回 instance_id、preview/activity revision、最新预览与活动快照，无持久 id，不推进 cursor；允许合并/舍弃。预览体积超限时移除部分条目并标 truncated；它不替代持久最终结果。实例变更清除旧“正在运行”显示，不能重放工具。流已建立后错误用无 id 的 `event: control` 并关闭；认证/参数错误优先在建立前返回正常 HTTP 错误。

## 通知目标与 ACK

Notification 保留内容/意图；NotificationRouting 保存是否已绑定目标；NotificationDelivery 保存各目标的稳定 delivery_id、内容版本和三个独立时间事实。创建新通知时与当时启用的目标 Delivery 一起原子提交，离线目标也包括在内。

无目标时保存 UNROUTED。客户端明确启用后用 `POST deliveries/claim {request_id}` 领取至多100条未路由的新意图；需要更多时使用新的 request_id 再领取。同 request_id 重试只对账原批。此显式命令与启用目标分开，便于限量恢复；读取不领取。后来注册的目标不追发已路由通知。禁用只停止后续路由，已有 Delivery 可对账。

`GET notifications` / `notifications/{id}` 是内容元数据和历史；`notifications/{id}/content?cursor=...` 每次返回最多32 KiB UTF-8 文本，不切断 Unicode 标量。固定64 KiB缓冲校验完整 CAS 散列，同时收集返回片段，避免整段长文本驻留。通知正文不包含在 bootstrap/feed。

`GET deliveries` / `deliveries/{id}` 必须携带目标 binding，只读本目标。`POST deliveries/{id}/ack` body 为 `{request_id, kind, content_version}`，kind 为 received/presented/read：

| kind | 客户端须先满足 | 服务端作用 |
| --- | --- | --- |
| received | 内容和 delivery_id 已在本地持久落地 | 保存 received_at |
| presented | 已实际展示且 received 已确认 | 保存 presented_at 及可验证展示事件 |
| read | Master 明确已读且 presented 已确认 | 保存 read_at |

服务端只记录客户端声明的事实，不能通过 socket 写成功证明客户端行为。前置事实不足为 ACK_PRECONDITION，不自动补造；乱序客户端先查询/重传前一步。相同 request_id 改参冲突，原请求响应丢失可按原 ID 重试/查询。不同 request_id 重复确认同事实不增加 Delivery revision 或重复展示事件。A 的 ACK 不改变 B；首期没有全局已读自动抑制规则。

旧 Notification/receipt/log/CAS 原样保留，初始化前的旧 QUEUED/SENDING/SENT/FAILED/DELIVERY_UNKNOWN 不自动产生新端投递。历史 SENT 只保留原通道证据，不能伪造新端的 received/presented/read。后台读取或历史同步不会重新弹出全部旧通知。

原记忆承诺的狭义“结果已汇报”校验接受可验证新版 presented 证据，同时保留旧证据校验。received 不能履约；later read 不使既有展示证据失效；仍检查同会话、来源先后、任务/结果关联，不自动批准、回答或完成其他承诺。

## 恢复与边界

正常重启保留同步历史和签名材料。首期不自动裁剪 journal、请求去重或投递记录。恢复/回退到不同历史时，使用显式 `sync/reset-history` 更新 journal 数据代次；World 的 `admin/world/reset-history` 更新独立代次，后者是需对账的长命令。先停止业务派发并核对外部副作用，不让恢复备份重新执行 UNKNOWN。这些命令不是备份工具，也不授权生产操作。

若外部直接复制了一份具有相同前缀和身份的旧备份，单个前缀 cursor 无法识别该外部行为；恢复操作者必须执行代次更新。链上未来位置/分叉 digest 会被拒绝。回退需完整 journal/CAS/身份材料与配套数据库，旧运行时不能直接打开新增记录。

World 使用原 audit_outbox 的稳定 event_id，单批至多100条且同进程 export 串行。SQL 已提交/未 export、已 journal/未标记 exported_at 两个窗口都可恢复；不重复 apply，积压由既有后台 drain 继续处理。数据库故障返回明确不可用/积压/导出失败；不因查询而推进导出或业务动作。

本期不含 SwiftUI 页面与真实客户端持久缓存实现、真实模型/设备测试、生产迁移、硬件断电持久性或大规模长期负载证明。隔离验证与保留失败见 [Issue #9 验证记录](sync-verification.md)。
