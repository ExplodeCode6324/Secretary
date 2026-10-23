# 给 #82 的旧可靠性行为索引

状态：#79 R2 计划附件；仅历史源码索引，不是新 TUI 已实现或通过测试的证据。旧测试实现按 #79 删除，不复制进新客户端。公共 Core 测试继续保留。

需求 REL-01～REL-06 见 [TUI 可靠性要求](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/docs/tui/requirements-and-backend-plan.md#L282)。

| 要求 | 历史实现/验证线索 | 接续限制 |
| --- | --- | --- |
| REL-01 草稿交接/同 ID 对账 | atomic_draft_enqueue_and_commit_failure、response_lost_same_id_conflict_and_restart、client_sigkill_at_durable_boundaries、accepted_post_with_invalid_response_reconciles_original_id_without_repost | 新 TUI 自己验证原子性及崩溃恢复；不迁移旧草稿 |
| REL-02 受理/业务结果分离 | unknown_and_missing_receipts_never_replay_and_quotas_preserve_draft、stop_is_never_replayed_after_client_reopen | 不因未知结果或 Core 实例变化自动重放 |
| REL-03 transient 非权威 | real_sse_receives_change_and_transient、durable_bursts_coalesce_without_interrupting_transient_at_real_tick_cadence | 预览按稳定身份替换，不当持久数据 |
| REL-04 应用后推进水位 | sync_atomic_cursor_aggregate_and_two_clients、initial_snapshot_catchup_does_not_lose_concurrent_change、rebuild_clears_unknown_sync_and_keeps_outbox | Core 的 issue9/cursor 回归保留；新客户端必须独立验证 |
| REL-05 阅读锚点 | [旧 conversation/model.ts](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src/conversation/model.ts) 与 #63 历史证据 | Rust 测试列表不构成阅读恢复验收；用新终端验证实例/内容/偏好变化 |
| REL-06 有界正文/驻留 | 同上及 [#63 交付证据](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/docs/fix/evidence/issue63-conversation/README.md) | 旧自动补读仍有缺口，不复制缺陷；最终真实长正文 NOT_ACCEPTED |

## reliability.rs 的带 test 标记用例

- [endpoint_permissions_mode_and_origin](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L84)
- [atomic_draft_enqueue_and_commit_failure](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L115)
- [response_lost_same_id_conflict_and_restart](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L165)
- [sync_atomic_cursor_aggregate_and_two_clients](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L201)
- [expired_token_and_invalid_cursor_preserve_intent](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L231)
- [sse_split_unicode_transient_and_bounds](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L259)
- [protocol_precision_unknown_enums_and_route_controls](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L271)
- [actual_disk_full_preserves_draft](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L284)
- [stop_is_never_replayed_after_client_reopen](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L299)
- [profile_config_and_bridge_snapshot_do_not_expose_token](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L319)
- [backup_fork_resync_preserves_accepted_evidence](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L361)
- [crash_child](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L407)
- [client_sigkill_at_durable_boundaries](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L441)
- [real_sse_receives_change_and_transient](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L481)
- [core_sigkill_rotates_instance_and_resumes](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L510)
- [real_artifact_download_integrity_and_corruption](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L530)
- [unknown_and_missing_receipts_never_replay_and_quotas_preserve_draft](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L561)
- [initial_snapshot_catchup_does_not_lose_concurrent_change](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L605)
- [storage_migration_permissions_and_domain_isolation](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L626)
- [notifications_capability_and_expired_page_recover](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L645)
- [outbox_fifo_prioritizes_new_work_over_history](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L658)
- [rebuild_clears_unknown_sync_and_keeps_outbox](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L707)
- [stream_boundary_and_delivery_claim](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L732)
- [real_sse_survives_more_than_thirty_seconds](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L748)
- [independent_writers_wait_before_reading_a_wal_snapshot](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L785)
- [resolved_history_yields_capacity_without_losing_pending_intent](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L846)
- [real_tick_cadence_keeps_transient_alive](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L882)
- [durable_bursts_coalesce_without_interrupting_transient_at_real_tick_cadence](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L904)
- [malformed_stream_can_retry_but_unknown_sync_semantics_halt](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L1007)
- [approval_intents_are_unique_until_resolved_across_connections](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L1027)
- [accepted_post_with_invalid_response_reconciles_original_id_without_repost](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/reliability.rs#L1047)

## 新入口提醒

现有 `test_case/offline/runtime/retired-entrypoints.test.ts` 明确禁止旧 `src/pi_secretary/src/tui.ts` / `client-tui.ts` 等入口。#82 应明确选择新入口；若确需重用路径，应有意调整这条旧入口断言并保持旧 Web 路由拒绝语义，不误删整组 Core API 回归。
