# Core API v1

Core 为本机 owner 提供 64 项操作：37 GET、27 POST。公开合同包括 [JSON Schema](schema.json)、[操作表](operations.json)、生成的 [OpenAPI 3.1](openapi.json) 和 TypeScript DTO。客户端使用这些 DTO，内部 Store 记录另见[数据模型](../../data-model.md)。

[CoreClient](../../../src/pi_secretary/src/core-client.ts) 负责发现和请求，返回结构化数据。[examples.json](examples.json) 与 [Swift 解码示例](decode-examples.swift) 展示精度、Unicode 和未知字段处理。原生页面设计见[客户端 v0.3](../../native-client-design-v0.3.md)。

## 生命周期与连接

从仓库根目录执行 `npm start` 启动或连接 Core，`npm run core -- status|attach` 连接已有实例，`npm run stop` 停止后台。完整配置见[运行手册](../../operations.md)。

服务监听 `127.0.0.1` 动态端口。数据目录中的 core-endpoint.json 保存地址、token、实例和模式，权限为 0600，新建数据目录为 0700。客户端附着时核对文件 owner、权限和模式。CoreIdentity 的 owner/data_domain_id 持久保存，instance_id 每次启动变化。

每个请求使用 `Authorization: Bearer <token>`，可带 `X-Secretary-API-Version: 1`。Host 使用发现地址，Origin 如存在也须匹配。认证产生 local-owner principal。ClientRegistration 用于登记客户端身份，权限由认证决定。

Core stop 先持久受理再关闭；客户端退出后 Core 继续运行。旧 stop 请求在重启后仍返回原回执。当前入口均在 `/api/v1` 下，可靠同步、通知展示回执、设备和附件上传按后续路线扩展。

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

普通列表默认 30、上限 100；timeline 上限 200，并受 1 MiB 页面预算约束。cursor 是绑定查询范围、版本与实例的不透明值；CURSOR_EXPIRED 后重新载入。World 返回独立 world_version。当前游标用于分页，持久变更水位由 #9 补齐。

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

## 切换与回退

升级前备份完整 Store、World、代码及配置，在隔离副本验证重放。未完成 Settings 按原配置恢复。旧二进制的可读合同与当前版本不同，回退须使用匹配备份并对账期间已发生的作用；详见[持久化手册](../../persistence.md)。

版本化验证和首次失败保存在[验证记录](verification.md)；当前回归入口见[测试策略](../../testing.md)。
