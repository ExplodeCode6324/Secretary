# TUI 的 Core API 使用清单

状态：2026-10-30 #82 原生终端实现分支核对。下表区分客户端实际消费与尚未接入；代码尚待 CI、Claude 复核及完整产品原生验收，不表示已合并。键位为 Enter 换行、Shift+Enter 明确提交；启动说明和证据见 [#82 验证记录](../fix/evidence/issue82-rebuild/acceptance.md)。

每项实施 Issue 完成时，按当时的 [操作清单](../api/v1/operations.json) 更新本表，并在完成报告链接本次版本、说明使用变化和仍未使用的 API。测试对本地接口的调用不计为 TUI 已消费。未用 API 不要求补齐菜单，也不自动成为结项阻塞。

状态可记为：已用（列对应命令/功能）、未用（列原因）；新增/删除端点随操作清单同步。实际操作清单共 86 项（52 GET、34 POST）；新 TUI 已用 11 项、未用 75 项。

#81 的附件、撤回等合同保持不变；本批不增加对应 UI。下表的“已用”只代表 #82 实现调用，完整产品原生验收另列。

| Method | Path | 新 TUI 状态 | 对应功能或未用原因 |
| --- | --- | --- | --- |
| POST | /api/v1/assistant/profile | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/clients | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/notifications/{id}/presented | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/notifications/{id}/read | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/messages | 已用 | Main 明确提交；持久保存请求后才 POST |
| POST | /api/v1/task-requests | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/task-requests/{id}/cancel | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/executions/{id}/cancel | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/executions/{id}/viewed | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/decisions/{id}/answer | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/authorizations/{id}/decision | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/settings/draft | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/settings/apply | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/settings/applications/{id}/retry | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/settings/applications/{id}/restore-draft | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/session/compact | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/session/resume | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/memory/commitments/{id}/resolve | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/memory/extraction/retry | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/operations/{id}/verify-write | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/operations/{id}/resolve | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/admin/world/migrate | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/admin/programs | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/admin/authorization-rules | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/admin/authorization-rules/{id}/disable | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/core/stop | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/core | 已用 | 连接已有 Core，校验身份/模式 |
| GET | /api/v1/assistant | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/session | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/clients/{id} | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/requests/{id} | 已用 | 只读送达对账，不自动重发 |
| GET | /api/v1/settings | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/memory | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/memory/summary | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/memory/commitments | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/tasks | 已用 | 基础分页、实际执行状态及排队计数 |
| GET | /api/v1/tasks/{id} | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/tasks/{id}/requests | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/tasks/{id}/executions | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/task-requests/{id} | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/executions/{id} | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/decisions | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/decisions/{id} | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/authorizations | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/authorizations/{id} | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/attention | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/artifacts | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/artifacts/{id} | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/timeline | 已用 | 近期 50 条及运行期间新增补读 |
| GET | /api/v1/timeline/around | 已用 | 从已有末条定位补读新增 |
| GET | /api/v1/messages/{id}/content | 已用 | 正文分片组装 |
| GET | /api/v1/activities/{id} | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/related | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/world/catalog | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/world/facts | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/world/slot | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/operations | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/operations/{id} | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/admin/programs | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/admin/authorization-rules | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/artifacts/{id}/content | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/scopes | 已用 | Scope 名称；完整分组与统计属 #83 |
| GET | /api/v1/scopes/{id} | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/scopes | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/scopes/{id} | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/scopes/{id}/archive | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/authorization-rules | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/sync/cursor | 已用 | 流订阅及尝试后的连续性标记 |
| GET | /api/v1/sync/changes | 已用 | 跨实例未送达证明的连续性校验 |
| GET | /api/v1/sync/stream | 已用 | 增量变更提示刷新 |
| GET | /api/v1/notifications | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/notifications/{id} | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/operations/{id}/content | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/wakeups | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/wakeups/{id} | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/wakeups/{id}/cancel | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/push-targets | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/push-targets/{id} | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/push-dispatches | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/push-dispatches/{id} | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/push-targets | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/push-targets/{id} | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/attachments/import | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/attachments/{id} | 未用 | 本批未接入；后续按对应功能范围处理 |
| GET | /api/v1/attachments/{id}/content | 未用 | 本批未接入；后续按对应功能范围处理 |
| POST | /api/v1/inputs/{id}/withdraw | 未用 | 本批未接入；后续按对应功能范围处理 |
