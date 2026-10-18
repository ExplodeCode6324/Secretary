# Core API v1

Core 为本机 owner 提供命令、查询和增量同步。[操作表](operations.json) 列出全部路由，[JSON Schema](schema.json)、[OpenAPI 3.1](openapi.json) 和 [TypeScript DTO](../../../src/pi_secretary/src/api/contracts.ts) 定义公开合同。[CoreClient](../../../src/pi_secretary/src/core-client.ts) 封装发现与请求；[样例](examples.json) 和 [Swift 解码示例](decode-examples.swift) 展示字符串精度、Unicode 及扩展字段处理。

## 连接与认证

按[运行手册](../../operations.md)启动 Core。服务监听 `127.0.0.1` 动态端口，数据目录的 `core-endpoint.json`（0600）保存地址、token、instance_id 和模式。CoreClient 核对文件 owner、权限与模式；owner/data_domain_id 跨重启保持，instance_id 每次启动变化。

请求携带 `Authorization: Bearer <token>`，可带 `X-Secretary-API-Version: 1`。Host 匹配发现地址，Origin 如存在也须匹配；认证产生 local-owner principal，ClientRegistration 登记展示客户端身份。路由前缀统一为 `/api/v1`。

## 命令与回执

POST 使用 application/json，body 最大 1 MiB，包含 UUID request_id。owner、路径和规范化 body 共同绑定意图；相同 ID 同参重投返回原回执，改变内容返回 REQUEST_CONFLICT。HTTP 202 表示受理已持久保存，`GET requests/{id}` 提供回执，关联资源提供业务进度。

短命令将 ApiCommand 与首次领域变更同事务提交，通常保持 ACCEPTED；无变化也保存 NO_CHANGES 回执。长命令从 QUEUED 到 RUNNING，再到 COMPLETED 或 UNKNOWN；重启继续未开始的 QUEUED，中断的 RUNNING 转 UNKNOWN，按领域回执对账。`memory/extraction/retry` 为短命令，后台继续补提。

| 收到的结果 | 客户端处理 |
| --- | --- |
| 命令 POST 400/404/409/410/422 | 本次提交在受理前被拒绝；REQUEST_CONFLICT 时保留原 ID 的已有回执 |
| 202 | 保存回执并查询关联资源 |
| 超时、断连、5xx | 用原 request_id 查询；找到回执就对账；明确 NOT_FOUND 且本地无已受理/UNKNOWN 证据时按原 ID、路径和 body 重投 |
| 401/403 | 修复认证或请求来源后再操作 |

已受理后的领域错误保留回执。上述拒绝规则针对命令 POST；GET 的查询错误按其错误码处理。

## 查询、分页与内容

响应为 `{api_version:"1",data:...}`，错误为 `{api_version:"1",error:{code,message}}`。revision、事件 sequence、World version 和字节长度使用十进制字符串，数量与 limit 使用有界整数，时间为 UTC ISO 8601。请求按 schema 校验，客户端按已知字段解码响应。

普通列表默认 30、最多 100；cursor 绑定实例、查询范围/筛选和最后稳定键，改变 limit 可继续，CURSOR_EXPIRED 后重新载入。列表按首次事务位置与 ID 等稳定键分页，变化通过同步补齐；timeline、消息内容与 World 使用各自游标语义。GET 读取状态；用户访问执行详情通过独立 viewed 命令续留 HOT。

| 内容 | 使用方式 |
| --- | --- |
| timeline | 上限 200，页面预算 1 MiB；around 以 message_id 或 event_id 定位；streaming/thinking 加入临时预览，按 call_id 与最终消息合并 |
| messages/{id}/content | 沿 next_cursor 续读 Unicode 分片 |
| operations/{id} | display 含 parameters/stdout/stderr/reason，附 state、bytes、content_version、truncated、next_cursor、unavailable_reason；首段上限依次 16/32/32/4 KiB，完整详情最多 256 KiB |
| operations/{id}/content | part 选择上述段，cursor 续读；每段最多 32 KiB，响应最多 256 KiB，按顺序拼接后解析 JSON；CURSOR_EXPIRED 从首段重读 |
| artifacts | 按 artifact ID 下载固定 CAS 字节，校验散列与长度；relative_path、path_base、scope_id 提供安全相对定位，缺少绑定时标为 unknown |

Operation 的 bytes/hash 指完整公开文本；source_truncated 表示执行器截断源输出，分页 truncated 表示本页还有内容。裁定后的 stdout/stderr 保留原回执，reason.resolution_note 提供裁定说明。公开投影保留业务 JSON，移除 shell 内部环境、program 入口/工作区和内部 CAS 定位；源文件缺失、损坏或不安全时返回 unavailable 原因。实现见 [operation-display](../../../src/pi_secretary/src/operation-display.ts)。

## 业务资源

| 资源 | 用途 |
| --- | --- |
| assistant/profile、messages、session | 显示名、输入、整理与恢复 |
| tasks、task-requests、executions | 任务基线、每轮提案、排队/取消、结果与接续；tasks 可按 scope_id 筛选，none 表示无范围绑定 |
| scopes、authorizations、authorization-rules、decisions、operations | 工作范围、审批/规则、工作回答与效果核验 |
| settings、memory、memory/summary、memory/commitments | 草稿应用、维护进度、摘要与承诺来源 |
| world/catalog、world/facts、world/slot | 实体/predicate/source、当前和历史事实、slot revision |
| related、attention | 关联资源、待办计数及有界列表，attention 提供 version/as_of/valid_until |
| requests、clients、core、admin | 回执、客户端登记、服务启停、World 迁移与程序登记 |

PublicTaskCommand 使用 `acceptance` 字符串数组；接续同时传 reuse_task_id 和 parent_execution_id，规则见[任务数据流](../../data-flow.md#任务从提案到结果)。Settings 保存完整 instructions/edits/command_ids，使用 expected_revision 控制版本；World 新资源 revision 为 "0"，单次领域批次最多 50 项（公开结构上限 100）。

## Scope、授权与效果裁定

Scope 创建必填 name/kind。DIRECTORY 指向已有物理 root_path，notes_path 默认 `.secretary/NOTES.md`；NONE 让各任务使用私有目录。修改/归档传 expected_revision；归档保留历史与已占槽执行。Execution 固定创建时的绑定，condition_results 返回 MET/NOT_MET/UNKNOWN 及 evidence，目录条件可返回 SCOPE_BUSY、SCOPE_ARCHIVED、SCOPE_ROOT_CONFLICT。

`default_write=allow|ask` 默认 allow。审批通过 `authorizations/{id}/decision` 提交 expected_revision、display_hash 和 APPROVE/REJECT/REVOKE；APPROVE 可附 remember，例如 shell 的 `{prefix_tokens:2,expires_at:null}` 或 write 的 `{path_prefix:"src",expires_at:null}`。remember_context 提供待展示的根及原始参数，服务端原子提交授权与规则。撤销单次授权后，持久规则可通过 admin/authorization-rules/{id}/disable 单独停用。

规则支持旧 parameters 精确匹配，或 constraints 的 file-prefix、command-prefix、program（二选一），可限定 valid_from/expires_at；world.change 使用精确参数。GET authorization-rules 返回规则与 builtin_policies；match_count/last_matched_at 按成功提交派发的唯一 Operation 计算。内建只读命令以固定 argv 执行，用户 shell 前缀规则仍经 bash，具体策略见 [shell-policy](../../../src/pi_secretary/src/shell-policy.ts)。

`operations/{id}/resolve` 接受 request_id、expected_revision、outcome、note；outcome 为 APPLIED/NOT_APPLIED/PARTIAL/UNVERIFIED。`verify-write` 按绑定根及预期内容核验文件。效果裁定、其余未知项处理与进程停止共同决定执行收束；详情公开 effect、resolution 和 process_state。

## 增量同步

先 GET sync/cursor 取得 S，再加载资源，最后 GET sync/changes?after=S 追赶并连接 sync/stream。cursor 绑定 owner_id、事务 sequence 和 journal digest，正常重启可续传；换数据域、截短备份或历史分叉返回 409 RESYNC_REQUIRED，此时重新加载并保留原命令对账。

changes 默认/最大检查 100 个事务，含无公开变化的事务，返回 transactions、next_cursor、has_more，页面最多 256 KiB。事务完整交付，过大时转为全部相关类别的 invalidate。record 带 resource_type/resource_id/revision；invalidate 要求刷新指定聚合或集合，即使根 revision 相同。分页 version 是观察水位。

SSE 每事务发送 event: change，id 为事务后 cursor；空 changes 也推进。约 5 秒注释心跳，transient 的预览/活动无 id。after 与 Last-Event-ID 同时提供时必须一致。客户端把刷新数据和已应用水位一起落盘后推进 cursor，保留最后发起的刷新结果，最新失败保留待刷新状态。每连接待写预算 512 KiB，drain 最多 5 秒，最多 8 条流；慢连接断开后从已应用水位续传。实现见 [sync-service](../../../src/pi_secretary/src/sync-service.ts)、[sync-stream](../../../src/pi_secretary/src/sync-stream.ts)。

## 通知、提醒与推送

notifications 返回全局集合，presented 为每客户端首次展示时间，read_at 为全局首次已读。created_sequence 固定创建位置，初始水位之前的通知加载为历史；后来的 read/presented 更新保留原创建位置。通知 content 内联 text/media_type/content_version/bytes/truncated，列表每项最多 2 KiB、详情 64 KiB，截断 JSON 按文本呈现。

`notifications/{id}/presented` 带 request_id/client_id，客户端须已在本数据域登记；展示事件与受理同事务提交，重复展示返回原记录或 NO_CHANGES。`notifications/{id}/read` 只带 request_id，保留首次 read_at。两者独立于渠道状态，处理回执不触发 Input 或模型。

wakeups 支持列表、详情和 `{id}/cancel`，state 可筛 PENDING/FIRED/CANCELLED；创建由主会话工具完成。取消只改变 PENDING，FIRED 表示 TIMER Input 已入队；创建、触发和取消进入 ChangeFeed。恢复补交到期项，主会话决定是否通知。推送目标、私密配置、免打扰和重试见[服务端推送](push.md)。

## 当前限制

- 通知内容提供有界内联文本，尚无通知正文分页端点。
- wakeups 公开 API 提供查询与取消，创建由主会话 schedule_wakeup 工具完成。

升级与验证入口见[运行手册](../../operations.md)，版本化验收见[历史验证记录](verification.md)。
