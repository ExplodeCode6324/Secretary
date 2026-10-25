# TUI 的 Core API 使用清单

状态：#82 本地浏览器命令界面已接入以下操作；实现、测试、CI、Claude 复核和人工验收分别记录于[实施证据](../fix/evidence/issue82-tui/implementation.md)。产品使用见[运行指南](browser-guide.md)。

以 [operations.json](../api/v1/operations.json) 的 86 项为准（52 GET、34 POST）；新客户端已用 10 项（9 GET、1 POST），未用 76 项。未用 API 不要求补齐菜单，不自动构成结项阻塞。测试单独调用不计为客户端消费。本次未新增 Core API。

| Method | Path | 新 TUI 状态 | 对应功能或未用原因 |
| --- | --- | --- | --- |
| POST | /api/v1/assistant/profile | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/clients | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/notifications/{id}/presented | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/notifications/{id}/read | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/messages | 已用 | Main 与显式 /send；冻结原字节发送 |
| POST | /api/v1/task-requests | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/task-requests/{id}/cancel | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/executions/{id}/cancel | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/executions/{id}/viewed | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/decisions/{id}/answer | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/authorizations/{id}/decision | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/settings/draft | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/settings/apply | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/settings/applications/{id}/retry | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/settings/applications/{id}/restore-draft | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/session/compact | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/session/resume | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/memory/commitments/{id}/resolve | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/memory/extraction/retry | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/operations/{id}/verify-write | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/operations/{id}/resolve | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/admin/world/migrate | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/admin/programs | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/admin/authorization-rules | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/admin/authorization-rules/{id}/disable | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/core/stop | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/core | 已用 | attach-only 身份、模式与实例核对 |
| GET | /api/v1/assistant | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/session | 已用 | Main 会话状态 |
| GET | /api/v1/clients/{id} | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/requests/{id} | 已用 | 原请求回执核对；不单凭 GET 清理正文 |
| GET | /api/v1/settings | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/memory | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/memory/summary | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/memory/commitments | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/tasks | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/tasks/{id} | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/tasks/{id}/requests | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/tasks/{id}/executions | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/task-requests/{id} | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/executions/{id} | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/decisions | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/decisions/{id} | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/authorizations | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/authorizations/{id} | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/attention | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/artifacts | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/artifacts/{id} | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/timeline | 已用 | Main 初始与分页读取；thinking=false |
| GET | /api/v1/timeline/around | 已用 | 稳定消息/事件阅读锚点恢复 |
| GET | /api/v1/messages/{id}/content | 已用 | 显式 /cotvisible、/more 和有界 /copy |
| GET | /api/v1/activities/{id} | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/related | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/world/catalog | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/world/facts | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/world/slot | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/operations | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/operations/{id} | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/admin/programs | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/admin/authorization-rules | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/artifacts/{id}/content | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/scopes | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/scopes/{id} | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/scopes | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/scopes/{id} | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/scopes/{id}/archive | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/authorization-rules | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/sync/cursor | 已用 | 冷启动 C0 |
| GET | /api/v1/sync/changes | 已用 | 有界补齐事务 |
| GET | /api/v1/sync/stream | 已用 | SSE durable invalidation 与 transient preview |
| GET | /api/v1/notifications | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/notifications/{id} | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/operations/{id}/content | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/wakeups | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/wakeups/{id} | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/wakeups/{id}/cancel | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/push-targets | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/push-targets/{id} | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/push-dispatches | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/push-dispatches/{id} | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/push-targets | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/push-targets/{id} | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/attachments/import | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/attachments/{id} | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| GET | /api/v1/attachments/{id}/content | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
| POST | /api/v1/inputs/{id}/withdraw | 未用 | 不属于 #82 Main/本地草稿范围；后续按明确授权接入 |
