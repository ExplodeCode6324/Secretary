# TUI 的 Core API 使用清单

状态：2026-10-31 #83 实现核对，新增 5 个只读 Task-browser 端点；TUI 不再读取管理用途的 tasks/scopes 列表。运行和测试见[原生终端说明](run-and-test.md)，代码、真实 provider 与人工验收分开记录于 [#91 证据](../fix/evidence/issue91-main-history/acceptance.md)。

#91 新增消费路径：`timeline?limit=50&thinking=<mode>&streaming=true` 首屏与 before/after 游标补读；`timeline/around?item=<id>&limit=1&thinking=<mode>&streaming=true` 定位刷新及邻页恢复；`messages/{id}/content?thinking=<mode>&streaming=true&cursor=<opaque>` 连续正文/CoT 读取。正文游标失效时重新取得首片并重建检查点；正常流式版本替换静默重读，失败保留已读内容。`sync/stream` 的 transient `previews[].id` 只作为发现提示。已有 `messages` 提交、`requests/{id}` 状态、`sync/cursor`/`sync/changes` 对账继续继承 #82，新增的是粘贴快照及相同 request_id 恢复，不伪称新接口。对应测试在 `test_case/offline/issue91/`，真实流量证据与范围限制见上述验收记录。

每项实施 Issue 完成时，按当时的 [操作清单](../api/v1/operations.json) 更新本表，并在完成报告链接本次版本、说明使用变化和仍未使用的 API。测试对本地接口的调用不计为 TUI 已消费。未用 API 不要求补齐菜单，也不自动成为结项阻塞。

状态可记为：已用（列对应命令/功能）、未用（列原因）；新增/删除端点随操作清单同步。实际操作清单共 91 项（57 GET、34 POST）；新 TUI 已用 14 项、未用 77 项。

#81 的附件、撤回等合同保持不变；本批不增加对应 UI。下表的“已用”代表 #82/#91/#83 客户端实际调用，完整产品原生验收另列。

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
| GET | /api/v1/tasks | 未用 | #83 使用只读 task-browser；管理查询语义保持不变 |
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
| GET | /api/v1/timeline | 已用 | 近期 50 项、前后连续补读与同模式游标 |
| GET | /api/v1/timeline/around | 已用 | 稳定消息 ID 定位，刷新、模式变化和重启恢复 |
| GET | /api/v1/messages/{id}/content | 已用 | 完整正文/CoT、块分页、检查点失效重建 |
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
| GET | /api/v1/scopes | 未用 | #83 使用只读 task-browser；管理查询语义保持不变 |
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
| GET | /api/v1/task-browser | 已用 | 当前集合、全量 Scope/Shared/归档计数、稳定排序与双向游标；截止时间到期刷新 |
| GET | /api/v1/task-browser/locate | 已用 | /search_task、完整 ID 定位刷新、前缀补全；历史临时区不改变计数 |
| GET | /api/v1/task-browser/{task_id} | 已用 | /taskdetail 的计划/排队/结果文本、分页详情、最近三轮描述 |
| GET | /api/v1/task-browser/{task_id}/executions/{execution_id}/messages | 已用 | 按真实 agent.message 事件读取最近三轮；每轮消息双向分页与 ID 恢复 |
| GET | /api/v1/task-browser/{task_id}/executions/{execution_id}/messages/{message_id}/content | 已用 | 正文、工具调用/结果、可显示 CoT 的游标补读；共享 Main CoT 开关 |

#83 保持其他未用接口及理由不变，尤其不调用 `executions/{id}/viewed`，不因阅读延长保留期限。Task 根列表最多保留 200 行元数据；三轮对话合计 200 条消息、4 MiB 正文/CoT，和 Main 共用最多两个并发读取。API 明确排除归档 Scope；完整 ID 或旧游标不能绕过。细节和证据见 [#83 验收](../fix/evidence/issue83-task-browser/acceptance.md)。
