# TUI 的 Core API 使用清单

状态：2026-10-23 #80 实施核对；旧客户端已由 #79（PR #85）移除，新 TUI 尚未构建。#80 更新回复终态与短推理预览投影，未新增或删除端点；测试调用不计入客户端消费。下表描述新 TUI 消费情况，不评价旧 Tauri 的接口使用。

每项实施 Issue 完成时，按当时的 [操作清单](../api/v1/operations.json) 更新本表，并在完成报告链接本次版本、说明使用变化和仍未使用的 API。测试对本地接口的调用不计为 TUI 已消费。未用 API 不要求补齐菜单，也不自动成为结项阻塞。

状态可记为：已用（列对应命令/功能）、未用（列原因）；新增/删除端点随操作清单同步。操作清单核对基线：0bbb110874da978805aeb00c99573ee18fc49260，#80 保持该清单，共 82 项操作（50 GET、32 POST）；新 TUI 已用 0 项、未用 82 项。

本次变化涉及 GET `/api/v1/timeline`、`/api/v1/timeline/around`、`/api/v1/messages/{id}/content`、`/api/v1/sync/stream`、`/api/v1/activities/{id}`，以及共享消息身份在 `/api/v1/related` 中的定位。以下均仍未被新 TUI 消费。

| Method | Path | 新 TUI 状态 | 对应功能或未用原因 |
| --- | --- | --- | --- |
| POST | /api/v1/assistant/profile | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/clients | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/notifications/{id}/presented | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/notifications/{id}/read | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/messages | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/task-requests | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/task-requests/{id}/cancel | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/executions/{id}/cancel | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/executions/{id}/viewed | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/decisions/{id}/answer | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/authorizations/{id}/decision | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/settings/draft | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/settings/apply | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/settings/applications/{id}/retry | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/settings/applications/{id}/restore-draft | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/session/compact | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/session/resume | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/memory/commitments/{id}/resolve | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/memory/extraction/retry | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/operations/{id}/verify-write | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/operations/{id}/resolve | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/admin/world/migrate | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/admin/programs | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/admin/authorization-rules | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/admin/authorization-rules/{id}/disable | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/core/stop | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/core | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/assistant | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/session | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/clients/{id} | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/requests/{id} | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/settings | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/memory | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/memory/summary | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/memory/commitments | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/tasks | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/tasks/{id} | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/tasks/{id}/requests | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/tasks/{id}/executions | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/task-requests/{id} | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/executions/{id} | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/decisions | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/decisions/{id} | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/authorizations | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/authorizations/{id} | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/attention | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/artifacts | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/artifacts/{id} | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/timeline | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/timeline/around | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/messages/{id}/content | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/activities/{id} | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/related | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/world/catalog | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/world/facts | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/world/slot | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/operations | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/operations/{id} | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/admin/programs | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/admin/authorization-rules | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/artifacts/{id}/content | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/scopes | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/scopes/{id} | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/scopes | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/scopes/{id} | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/scopes/{id}/archive | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/authorization-rules | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/sync/cursor | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/sync/changes | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/sync/stream | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/notifications | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/notifications/{id} | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/operations/{id}/content | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/wakeups | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/wakeups/{id} | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/wakeups/{id}/cancel | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/push-targets | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/push-targets/{id} | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/push-dispatches | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| GET | /api/v1/push-dispatches/{id} | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/push-targets | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
| POST | /api/v1/push-targets/{id} | 未用 | 新 TUI 尚未构建；后续按实际需要接入 |
