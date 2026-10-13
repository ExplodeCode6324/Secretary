# Core API v1

Core 为本机 owner 提供 73 项操作：44 GET、29 POST。公开合同包括 [JSON Schema](schema.json)、[操作表](operations.json)、生成的 [OpenAPI 3.1](openapi.json) 和 TypeScript DTO。客户端使用这些 DTO，内部 Store 记录另见[数据模型](../../data-model.md)。

[CoreClient](../../../src/pi_secretary/src/core-client.ts) 负责发现和请求，返回结构化数据。[examples.json](examples.json) 与 [Swift 解码示例](decode-examples.swift) 展示精度、Unicode 和未知字段处理。原生页面设计见[客户端 v0.3](../../native-client-design-v0.3.md)。

## 生命周期与连接

从仓库根目录执行 `npm start` 启动或连接 Core，`npm run core -- status|attach` 连接已有实例，`npm run stop` 停止后台。完整配置见[运行手册](../../operations.md)。

服务监听 `127.0.0.1` 动态端口。数据目录中的 core-endpoint.json 保存地址、token、实例和模式，权限为 0600，新建数据目录为 0700。客户端附着时核对文件 owner、权限和模式。CoreIdentity 的 owner/data_domain_id 持久保存，instance_id 每次启动变化。

每个请求使用 `Authorization: Bearer <token>`，可带 `X-Secretary-API-Version: 1`。Host 使用发现地址，Origin 如存在也须匹配。认证产生 local-owner principal。ClientRegistration 用于登记客户端身份，权限由认证决定。

Core stop 先持久受理再关闭；客户端退出后 Core 继续运行。旧 stop 请求在重启后仍返回原回执。当前入口均在 `/api/v1` 下，可靠同步与通知展示回执已提供；设备和附件上传按后续路线扩展。

## 命令与幂等

POST 使用 application/json，body 上限 1 MiB，包含 UUID request_id。同一请求的 owner、路径和规范化 body 共同确定幂等身份；原 ID 重投原内容返回原回执，变更内容返回 REQUEST_CONFLICT。响应丢失时用 `GET /requests/{id}` 查询，再决定下一步。

HTTP 202 表示受理已持久保存。短命令将 ApiCommand 与首个领域变更写入同一帧，状态通常保持 ACCEPTED；关联资源提供业务进度。无变化的命令也保存 NO_CHANGES 回执。

长命令先 QUEUED，再 RUNNING，正常结束为 COMPLETED，异常或中断为 UNKNOWN。重启继续尚未开始的 QUEUED；UNKNOWN 通过关联领域回执对账。`memory/extraction/retry` 是短命令，固定当时失败的来源集合，后续由维护周期补提。

## 响应与分页

JSON 响应为 `{ "api_version": "1", "data": ... }`，错误为 `{ "api_version": "1", "error": { "code": "...", "message": "..." } }`。客户端按 code 处理错误。产物内容返回 application/octet-stream、Content-Length、ETag 和 attachment 文件名。

| HTTP | 常见含义 |
| --- | --- |
| 400 / 401 / 403 | 请求格式或版本错误 / 未认证 / 权限或 Origin 错误 |
| 404 / 405 | 资源或路由不存在 / 方法错误 |
| 409 / 410 | 冲突、版本陈旧或游标过期 / 产物归档 |
| 413 / 415 | body 超限 / 媒体类型错误 |
| 503 / 500 | 能力未配置或业务忙 / 内部错误 |

revision、事件序号、World version 和字节长度使用十进制字符串；数量与 limit 使用有界整数，时间为 UTC ISO 8601。predicate.value_schema 保留完整领域 JSON Schema。响应可增加字段，客户端按已知字段解码；请求按命令 schema 校验。

普通列表默认 30、上限 100；timeline 上限 200，并受 1 MiB 页面预算约束。普通列表 cursor 绑定查询范围、筛选、最后稳定键与实例；CURSOR_EXPIRED 后重新载入。World 返回独立 world_version。持久同步游标独立于分页游标，见下文。

`timeline/around` 二选一 message_id 或 event_id，返回周边窗口。`messages/{id}/content` 用 next_cursor 续读，按顺序拼接 Unicode 分片。`streaming=true` 加入临时预览，`thinking=true` 加入模型提供的可见思考；预览与最终消息共享 call_id。

GET 查询读取业务状态；用户打开执行详情时另提交 viewed 命令以续留 HOT 执行。

## 资源与操作

所有路径均以前缀 `/api/v1` 开始，完整参数以[操作表](operations.json)为准。

| 资源 | 当前行为 |
| --- | --- |
| assistant、assistant/profile | 查询与修改显示名；空白名称归一为 secretary，actor_id 固定为 assistant |
| messages、timeline、session | 输入、历史、预览、整理与恢复 |
| tasks、task-requests、executions | 计划基线、每轮要求、请求队列、结果、接续与取消 |
| authorizations | 查询完整 display，按 expected_revision、display_hash 提交 APPROVE/REJECT/REVOKE |
| decisions | 查询工作问题并提交回答 |
| scopes | 创建、修改、归档和查询工作范围 |
| operations | 查询作用与进程状态，核验文件写入或人工裁定 |
| settings | 有效说明、共享草稿、最近应用及 apply/retry/restore-draft |
| memory、memory/summary、memory/commitments | 维护状态、分页工作记忆、承诺及其来源 |
| world/catalog、world/facts、world/slot | 目录、当前/历史事实与精确 slot 版本 |
| artifacts | 分页产物目录、元信息及固定版本下载，可按 task_id 筛选 |
| related | 按 session/task/message/event 范围查询已记录关系 |
| attention | 审批与决定的计数和有界列表，附 version/as_of/valid_until |
| admin | World 迁移、程序登记与授权规则登记/停用 |
| requests、clients、core | 命令回执、客户端登记与服务状态/停止 |

PublicTaskCommand 的验收字段是 `acceptance` 字符串数组；接续同时提供 reuse_task_id 与 parent_execution_id。Settings 草稿提交完整 instructions/edits/command_ids，World 新资源 revision 使用 "0"。公开 edits 结构上限 100，领域层实际批次上限 50。

记忆来源提供内容版本、媒体类型和可用定位；明确 source_batch 时返回事件 ID。产物通过 TaskResult 关联的 CAS 内容读取，下载前核对散列和长度，再按 64 KiB 流输出。`verified_by` 当前为 NOT_VERIFIED，独立内容验算另行记录。

## 工作范围与未知结果

创建 Scope 必填 name/kind；description 默认空。DIRECTORY 提供已存在的物理 root_path，notes_path 默认 `.secretary/NOTES.md`；NONE 使用各任务独立目录。修改和归档带 expected_revision。范围从 ACTIVE 归档为 ARCHIVED，已有历史仍可查询。

TaskCommand 可带 scope_id；接续省略或 null 时继承原任务范围。Execution 创建时固定目录绑定，同一 DIRECTORY 串行，NONE 可并行。condition_results 返回 condition_id、MET/NOT_MET/UNKNOWN、checked_at、evidence 和可空 reason，范围原因包括 SCOPE_BUSY、SCOPE_ARCHIVED、SCOPE_ROOT_CONFLICT。证据包含 content_version、字符串 bytes 和 media_type。

`POST /operations/{id}/resolve` 接收 request_id、expected_revision、outcome、note。outcome 为 APPLIED / NOT_APPLIED / PARTIAL / UNVERIFIED，保存裁定后等待进程停止和其他未知项处理，再收束执行。`verify-write` 依据绑定目录和预期内容核验文件。Operation 查询公开 effect、resolution 摘要和 process_state，平台进程身份留在内部恢复记录。

## 原生客户端读取投影（Issue #10 A0）

`GET tasks?scope_id=<UUID>` 先按范围筛选再稳定分页；`scope_id=none` 只取无范围绑定任务，省略则返回全部。筛选条件绑定 cursor，不能跨范围复用。

`GET operations/{id}` 返回 OperationDetail，增加 display.parameters/stdout/stderr/reason。Operation 列表不内联这些长文本；列表当前页遇到损坏回执仍报错，不影响未读取的其他页。每段都有 state、text、十进制 bytes、content_version、truncated、next_cursor、unavailable_reason；bytes 和散列针对完整公开文本，空字符串 available 与没有记录的 unavailable 不同。首次 parameters 最多 16 KiB，stdout/stderr 各 32 KiB，reason 4 KiB；整个详情含响应外层最多 256 KiB，必要时缩小各段。超大的基础元信息返回 RESPONSE_TOO_LARGE，不返回超预算详情。

`GET operations/{id}/content?part=parameters|stdout|stderr|reason&cursor=...` 每次最多 32 KiB UTF-8 文本，完整响应含 JSON 转义不超过 256 KiB，不接受 limit。顺序拼接后才能解析 parameters/reason 的 JSON；分片不拆 Unicode 码点。cursor 绑定操作、部分、内容版本、数据域和当前服务实例；CURSOR_EXPIRED 后从该部分首段重读。display.source_truncated 为执行器是否已截断源输出（未知为 null），与本页 truncated 不同，续读不能恢复源输出丢弃的尾部。

parameters 公开动作使用的参数；shell 内部环境、program 内部入口和工作区、证据 CAS 定位路径不公开。业务 JSON 值中的同名键保留。reason 包含状态、effect、记录的错误及超时/信号/退出码；人工裁定后 stdout/stderr 仍来自原回执，完整裁定说明位于 reason.resolution_note。resolution.note 过长时显示真实前缀并标记 note_truncated。原始文件丢失、损坏、符号链接、无记录、过深结构或过长键分别返回明确 unavailable 原因；首次读取流式校验源散列，不执行模型、工具、命令或 viewed 操作。Core 实例内最多缓存 16 MiB / 64 项已校验的公开文本，单段最多 8 MiB；缓存命中复核源文件的设备、inode、长度、纳秒 mtime/ctime 和常规文件状态。来源变化、丢失或 symlink 会失效并重新校验，超出缓存容量或淘汰后回退到流式读取；不落盘、不跨实例共享。详情先生成一次有界首片，再按完整 JSON 大小缩片，不重新读取来源。

Artifact 新增 relative_path、path_base（scope/task/unknown）、scope_id 和 path_unavailable_reason。只显示执行固定绑定下的安全相对路径；绝对路径、越界片段、超过 4 KiB 的路径和没有历史绑定的信息不猜测，返回 unknown。路径只是显示定位，下载仍使用受认证的 artifact ID，不能用该字段直接打开本机文件。

这批接口为简洁的原生功能界面提供合同；后续客户端美学设计独立于接口语义。

## 切换与回退

升级前备份完整 Store、World、代码及配置，在隔离副本验证重放。未完成 Settings 按原配置恢复。旧二进制的可读合同与当前版本不同，回退须使用匹配备份并对账期间已发生的作用；详见[持久化手册](../../persistence.md)。

版本化验证和首次失败保存在[验证记录](verification.md)；当前回归入口见[测试策略](../../testing.md)。

## 授权规则与批准并记住

`POST scopes` / `POST scopes/{id}` 接受 `default_write: allow|ask`，缺失按 allow。`GET authorization-rules` 与原 `GET admin/authorization-rules` 返回规则分页，包含实际 constraints、resource_prefixes、时效和 builtin_policies。match_count 按成功提交派发的唯一 Operation 计数，last_matched_at 为该派发事件时间；结果未知仍计数，重复查询不增加。

批准时可传 remember，且只适用于 APPROVE：shell 使用 `{prefix_tokens: 2, expires_at: null}`，write 使用 `{path_prefix: "src", expires_at: null}`。shell 规则 cwd 范围固定为执行绑定根；write 的目录必须是目标祖先，`.` 明确覆盖全根。审批详情的 remember_context 提供根、动作、原始路径/命令 token，客户端据此在提交前展示范围。服务端复核原 revision/display_hash，在同一事务提交批准与规则；Authorization 的 remembered_rule_id 关联所建规则。撤销一次授权不会自动禁用持久规则，禁用仍走 admin/authorization-rules/{id}/disable。

owner 规则创建入口接受 parameters（旧精确匹配）或 constraints（二选一）。结构化约束形状为 `{kind:"file-prefix"}`、`{kind:"command-prefix",command_prefix:["npm","test"]}`、`{kind:"program",program_id:"<UUID>"}`，并可设 valid_from/expires_at。world.change 继续精确参数规则。模型不能创建或扩大规则。

## 持久同步与通知（Issue #9）

先 `GET sync/cursor` 得到 S（cursor、十进制 sequence、instance_id），再加载资源，最后 `GET sync/changes?after=S` 追赶并连接 `GET sync/stream`。after 与 Last-Event-ID 二选一或完全相同；冲突为 INVALID_QUERY。同步 cursor 只绑定 owner_id、事务 sequence 和 journal digest，无签名；正常重启可续传，换数据域、短备份或分叉返回 HTTP 409 RESYNC_REQUIRED。此时重新加载，未确认命令继续按原 request_id 对账。

changes 返回 transactions（每项 cursor、changes）、next_cursor、has_more，默认和最大检查 100 个事务，包括没有公开变化的事务。UTF-8 JSON 页面含外层最多 256 KiB。每事务完整交付，过大时退化为其全部相关资源类别的 invalidate；不拆片。kind=record 携带 resource_type/resource_id/revision；kind=invalidate 携带 resource_type/query，强制刷新，即使根 revision 相同。精确 query 如 tasks/{id} 刷新该聚合；集合 query 如 tasks/executions/notifications/world 刷新该类别已缓存的列表和详情（executions 为失效范围名，查询仍使用已有 tasks/{id}/executions 与 executions/{id}）。规则统计及 attention 依赖子资源和日志，不能只比较根记录 revision。分页 version 是观察水位，不能用作一致快照。

普通列表按首次事务位置和 ID（少数内嵌身份按稳定元组）续页；cursor 绑定实例、查询范围/筛选和最后键，改变 limit 可继续，不因无关提交或根 revision 改变失效。集合变化由 S 后同步补齐，timeline/消息分片与 World 保留各自分页语义。

SSE 为 text/event-stream，每完整事务一条 event: change，data 为 SyncTransaction，id 为事务后 cursor；空 changes 也推进。约 5 秒的注释心跳、event: transient 的 previews/activities 无 id。客户端保存的 Last-Event-ID 必须是已应用位置：刷新结果和水位一起落盘后才能推进。最后发起的刷新结果生效，较旧响应弃置；最新失败保留待刷新和旧水位。预览按 call_id 与最终保存消息合并。每连接待写预算 512 KiB、drain 最多 5 秒、最多 8 条流（BUSY/503）；慢连接独立断开，从已应用水位重连。

GET notifications 和 notifications/{id} 返回同一全局集合；read_at 缺失投影为 null，presented 为客户端首次展示时间数组。created_sequence 是首次创建位置，S 前通知只装载列表，不弹新系统通知；历史通知后来的 read/presented 不改变创建位置。内容以内联 UTF-8 文本提供，列表每项最多 2 KiB，详情最多 64 KiB；content 包含 text/media_type/content_version/原始 bytes/truncated。截断 JSON 作为文本显示；原文不截断，本版本无通知内容分页端点。

POST notifications/{id}/presented 接受 request_id/client_id，client 必须已在同一数据域注册。首个 notification.presented 日志事件与 ApiCommand 同事务保存；事件 ID 由通知/客户端确定，payload 只含通知 ID、客户端 ID 和服务端时间，未新增业务记录或快照。相同展示对换 request_id 为 NO_CHANGES；相同 request_id 沿用原回执和冲突语义。POST notifications/{id}/read 只接受 request_id，首次 read_at 全局单调保持。展示与已读分别上报，均不改变发送状态或触发 Input、模型和工具。展示证据不绑定通知 revision，内容/session/delivery_key 固定，read/发送进度不会使证据失效。

所有同步/资源 GET 纯读；启动恢复和后台业务另计。SwiftUI 的缓存、水位、乱序刷新和真实系统展示由 #10 接入；#22 渠道状态不能代报 presented/read。
