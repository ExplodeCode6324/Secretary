# Core API v1

Issue #8 的本机 owner 协议。原生页面遵循 [客户端 v0.3](../../native-client-design-v0.3.md)。

- [JSON Schema](schema.json) 定义独立于持久化 Store 的公开 DTO；[操作表](operations.json) 是 HTTP 路径、方法、命令 schema 和返回 schema 的冻结清单。
- [OpenAPI 3.1](openapi.json) 与 TypeScript DTO 由 `npm run api:generate` 生成。Swift 可从公开 schema 建模；[示例](examples.json) 和 `decode-examples.swift` 覆盖精度、Unicode、未知字段。
- `CoreClient` 返回结构化数据；未知查询显式为 `unknown`，调用者使用生成的 DTO。它不解析终端文本，不自动重试变更命令。

## 生命周期与连接

```sh
npm ci --ignore-scripts
npm run start:core
npm run core -- status
npm run core -- attach
npm run stop
```

直接 Core CLI（包括 stop）的数据目录由 `SECRETARY_DATA` 指定，默认 `.demo-data`。live wrapper 默认 `.demo-data/interactive-live`，管理其状态/停止时应显式使用匹配目录和 `SECRETARY_MODE=live`，见[运行手册](../../operations.md)。`SECRETARY_MODE=fixture` 默认使用离线合成模型；沿用已有 live 模型配置必须由操作者明确设置。`SECRETARY_DATABASE_URL` 配置可选 World 数据库；首次建库可由 owner 提交 `admin/world/migrate` 并查询回执。CLI 不打印 token。

Core 在 `127.0.0.1` 动态端口监听。发现文件 `core-endpoint.json` 和 `core.log` 权限为 0600，目录新建为 0700。附着验证本机文件 owner、权限、实例和模型模式。`status`/`attach` 不启动进程；`start` 的并发调用依靠既有 Store 文件锁竞争唯一 writer，失败的启动者附着到获胜者。客户端退出没有关闭业务的语义；显式 `core/stop` 受理落盘后关闭，重启仍可对账，重投旧 stop 不会再次关闭新实例。

`data_domain_id` 与 owner 是此数据目录持久身份；`instance_id` 每次启动变化。`clients` 返回持久 ClientRegistration 资源 ID，可携带 `client_id` 附着原登记及可选 `instance_id` 标识客户端进程。登记信息不能赋予权限。首次与重复登记均受 request ID 约束。首期没有远程或普通设备 principal，设备能力明确为 `not_supported`。

所有请求带 `Authorization: Bearer <endpoint token>`。可带 `X-Secretary-API-Version: 1`。Host 必须为发现文件中的 loopback 地址；若存在 Origin，也必须匹配。服务端从认证产生 owner principal；body 的 actor、role、device_id 等未知字段被拒绝。停止、规则、程序登记等仅此 owner 可用。

旧 `/api/client`、`/api/command`、`/api/poll`、静态 Web 路由均不注册。旧 Web/TUI 不兼容新版服务；源码最终退役属于 #10，未来 TUI 仅在 README 路线中。

## 请求、受理与重试

写入只能使用操作表列出的 POST，`Content-Type: application/json`，body 最大 1 MiB。每个命令必须有客户端持有的 UUID `request_id`；超时后保留原 ID、原路径和原 body。所有命令共享此数据域的 owner 请求命名空间。键排序后的 JSON 值、路径（含目标）、命令类型、CAS revision、审批显示 hash 和恢复 binding 全部绑定；相同 ID 改参数或改操作返回 `REQUEST_CONFLICT`。历史内部工作决定的 answer_request_id 也保留其占用身份，包括重启回放后；不能被新 API 操作重新使用。不自动过期或删除去重证据。

HTTP 202 表示持久受理；不表示任务、模型或外部操作成功。短命令的 ApiCommand 与首个领域变更在同一 fsync journal frame 内提交。后续初始化等仍由原领域恢复逻辑负责；回执提供资源链接，必须读取领域资源判断业务进度。没有变化的命令也持久保存回执，NO_CHANGES 可在 `requests/{id}.result` 查看。

取消、整理、恢复、文件结果核验与数据库初始化先提交 QUEUED 意图，再异步调用原领域入口。执行前记录 RUNNING，完成记录 COMPLETED 和可用结果；进程在 RUNNING 中断后恢复为 UNKNOWN，不自动重发潜在副作用。QUEUED 尚未开始，可在重启后推进，但仍须通过原领域的授权与前置条件校验。领域拒绝可能在异步结果中出现；UNKNOWN 的 `error_code` 和关联领域对象用于对账，不能凭新 request ID 自动重试。记忆恢复保留原先一次性 authorization_id、issued_at、expires_at 及全部来源/配置/模型 hash 校验；API 受理不能延长其有效期。恢复票据绑定当前 Store 实例；重启前受理但尚未消费的票据不能在重启后获得隐式续期，须重新 preflight、重新明确确认。旧命令按失败原因对账，不自动替换票据重发。

`GET requests/{id}` 返回受理回执、领域资源当前 revision/state 和结果。404 表示尚无受理证据；该查询不重新执行。ACCEPTED、COMPLETED 等是传输命令状态；Task/Execution/Operation 的原状态机仍是业务权威。

## 读取、游标与精度

响应为 `{ "api_version": "1", "data": ... }`；错误为 `{ "api_version": "1", "error": { "code": "...", "message": "..." } }`。不能按中文消息分支。二进制产物内容是此 JSON envelope 的例外，返回 application/octet-stream、Content-Length、ETag 与 attachment 文件名。常用映射：请求/格式/版本 header 错误 400，认证 401，权限/Origin 403，未找到/旧路由/不支持的 URL 版本 404，方法 405，冲突/陈旧/过期 409，归档产物 410，请求过大 413，媒体类型 415，能力未配置/业务忙 503；未知内部错误 500，HTTP 不返回栈或本机路径。

revision、journal/event sequence、World version、字节长度使用十进制字符串；数量与分页 limit 使用有界整数；时间为 UTC ISO 8601，包括 PostgreSQL 返回的时间；可空时间保持 null。predicate 的 value_schema 是完整的领域 JSON Schema，其 properties/required 等键和值原样输出，不按内部元数据字段名删改。Swift 不将 revision 解码为 Double。未知响应字段可忽略；未知状态/能力枚举显示保守状态且不开放动作；未知请求字段、命令、版本拒绝。

普通列表默认 30、最大 100；timeline 最大 200 且不超过既有 1 MiB 页面预算。默认向历史查询，`direction=after` 向后续查询。`cursor` 不透明，与查询范围、页版本及实例绑定；改变受绑定的查询范围、数据版本变化或重启可返回 CURSOR_EXPIRED，客户端重新载入。普通列表的 limit 不写入游标绑定，不应据此宣称改变任意分页参数必然失效。时间线游标使用投影 generation 与排序锚点；它不是 #9 的持久事件水位。World 返回独立 `world_version`，不宣称与 journal 形成跨存储原子快照。

`timeline/around` 必须二选一 `message_id` 或 `event_id`，返回有界周边窗口；无法定位返回 NOT_FOUND 类错误。`messages/{id}/content` 用 `next_cursor` 续读，无公开 JS UTF-16 偏移。分片不切开 Unicode scalar，可跨分片保留组合字符，按原顺序拼接得到原文。`thinking=true` 显式请求可见思考，`streaming=true` 包含临时预览；分片保留相同开关，版本变化须重载。预览与持久消息共享 call_id，临时预览不是可靠事件投递。

所有 GET 不写业务状态、不续留、不触发模型，也不标记通知已读。执行详情的用户打开行为使用 `executions/{id}/viewed`；RETIRED 不复活。Settings 共享草稿在 App 初始化时建立。

## 页面读模型与业务入口

- `assistant` 的 actor_id 固定为 assistant。显示名 trim 后为空回退小写 secretary；修改显示配置不调用模型、不改人格与记忆。人格说明继续通过 Settings draft/apply。
- `tasks/{id}` 提供基线要求、实际要求、接续条件、最近执行和结果摘要。历史执行与待执行请求分别从 `tasks/{id}/executions`、`tasks/{id}/requests` 分页。`task-requests/{id}` 提供请求的实际状态和取消原因。续接命令使用 reuse_task_id、parent_execution_id，材料和前置条件沿用原 Scheduler。
- `authorizations/{id}` 包含完整 display；decision POST 必须提交 expected_revision、display_hash 和 APPROVE/REJECT/REVOKE。普通消息不具备审批语义。工作决定使用独立 `decisions/{id}/answer`，沿用 deadline/OPEN/WAIT_DECISION 校验。
- `settings` 返回有效说明、共享草稿和最近应用。保存与 apply/retry/restore-draft 均有独立 request ID。World edit 的 expected_revision 也是字符串，新增资源用 "0"。`world/slot` 精确匹配 subject/predicate/scope；`world/catalog` 使用 kind=entities/predicates/sources；facts 支持 subject/predicate/history。
- `memory/summary` 与 `memory/commitments` 是分页只读投影，不透传 PromptSnapshot 或整个 Consciousness。来源保留内容版本/媒体类型；缺乏明确事件绑定时 locator_state=unavailable，不把相同内容 hash 推断为相同来源。承诺如有原领域 source_batch，另提供明确 source_event_ids。
- `artifacts` 为索引化分页目录，可加 task_id。ID 与文件名分离，重名不冲突。元数据包含 content_version、字节长度、media_type 和 available/archived。内容只从已知 TaskResult 的 CAS 引用读取，验证散列，拒绝任意路径和符号链接；通过 64 KiB 流读取，下载为 attachment，归档明确不可读。
- `related` 接受 scope_type=session/task/message/event 和 scope_id，仅使用已有 scope 与 TaskResult 关系，不以关键词或模型猜测。默认唯一 session。普通滚动不自动改变作用域。
- `attention` 从审批/决定原状态投影计数与有界列表，具有相同 version、session_id、as_of、valid_until。到 valid_until 必须刷新，即使没有 journal 变化；查询不代表批准或已读。
- 管理能力包括程序登记、授权规则登记/禁用、Operation 查询与 `operations/{id}/verify-write` 核验未知写入结果。程序登记是完整程序权限确认，不能供未来设备 principal 直接复用。

服务端能力与客户端本地页面是否实现是不同维度。字体、旁栏宽度、滚动、未发送草稿不保存到 Core Settings。设备/上传/可靠同步明确尚不支持；#9 接入持久同步，#10 实现原生界面。

## 切换与回退

本次新增持久记录，不修改或清空已有记录，也不运行生产数据迁移。固定旧版本基线 `f8dbddcf4338914c1d264efff0fd26d5bc07c2cb` 对应的运行时；切换前停止旧 writer，备份整个数据目录及配套 PostgreSQL，并记录版本、配置、备份校验。未完成 Settings 要求其原运行时恢复，不能跳过现有保护。使用隔离备份验证回放后才由操作者决定切换。

新版开始写入后，旧版本不认识新增 schema，不能直接降级读取同一目录。回退必须同时恢复经核验的旧数据备份和配套数据库、原代码及配置，先对账新旧期间的外部副作用，不能用旧备份重复执行不明操作。两个版本不能同时写同一数据域。本分支使用隔离数据验证；当前验证结果与有界真实模型测试的范围见 [验证记录](verification.md)。未操作现有实例。


## 当前明确边界

- 59 项操作（36 GET、23 POST；去重后使用47种 request/response DTO）以 operations.json 为完整入口清单；没有旧 SSE、公开 capacity 面板或 Notification presented/已读命令。Host 仍可创建 QUEUED 通知，旧 TerminalController 曾写 SENT；当前 GET 不会产生该回执，也不能自动满足依赖送达证据的承诺。
- 短命令 ApiCommand 保持 ACCEPTED，不承诺统一转 COMPLETED；读取 resource_ids 所指领域状态。长命令派发异常与中断统一保留 UNKNOWN，不以 schema 中的 FAILED 枚举推断已实现该分支。
- 公共 TaskCommand 的字段为 acceptance（字符串数组），不是内部 TaskProposal.acceptance_criteria；公开可选字段的缺省与内部工具的 null 语义不能混用，提交前按公开 schema 校验。
- DraftCommand.edits 的结构上限是100，但 SettingsPayload 领域层仍限制50；实际可提交批次应遵守更严格的50项。公开 DTO 合法不保证领域前提、权限和资源版本通过。
- Artifact 有值与内容正确是不同结论。当前 TaskResult.verified_by 为 NOT_VERIFIED；shell 产物 producing_operation_id 可以为空，独立来源验算须结合执行作用域、成功回执及下载散列。

Master 已确认 aa47ad5 实现完成复审；本轮文档对齐待 Master 复核，PR 保持 draft。此前完整验收记录保留在 verification.md，文档更新不等于重跑真实模型、部署或实现后续客户端。
