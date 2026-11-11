# #112 validation and retained history

Implementation follows the approved R5 World portion; Scope and Shared are separate issues. The first reproduced product failure was absent World/role entities without a PostgreSQL DSN. First failures and raw evidence are retained in the ignored `.demo-data/issue112` directory of the task worktree.

## Active coverage

| Requirement | Active verification |
|---|---|
| Store authority, deterministic protected roles, restart | `test_case/offline/issue112/world.test.ts` |
| One exact grant for mixed create/assert, target correction, expiry, owner epoch, approval ordering | `test_case/offline/issue112/world.test.ts` |
| Owner command, preview without journal effects, atomic Secretary profile update, Settings rejection | `test_case/offline/issue112/api.test.ts` |
| Populated legacy snapshot, old IDs/metadata, pending outbox and retry, unavailable database, runtime activation | `test_case/offline/issue112/migration.test.ts` |
| Frozen Main prompt/recall, withdrawal, actual SIGKILL before/after journal_apply and replay | `test_case/offline/issue112/snapshot.test.ts` |
| 40 development probes, full conflict groups/negation, 10,015-fact p95 | `test_case/offline/issue112/recall.test.ts` |
| Log-index SQL crash, model proposal fsync replay, paginated reads | `test_case/offline/issue21/{crash,read,world}.test.ts` |
| Independent Settings summary/rebuild/crash and instruction authority | `test_case/offline/runtime/settings.test.ts`, `test_case/offline/issue3/*.test.ts` |
| Attachment history and live evidence withdrawal | `test_case/offline/issue81/history.test.ts` |
| Guarded internal journal_apply versus external Operation edges | `test_case/offline/issue25/transitions.test.ts` |
| Opus R1: interrupted upgrade restart, first-frame bootstrap, old empty domains, historical policy replay, status/time labels, idle decision I/O | `test_case/offline/issue112/review-r1.test.ts` |

Historical SQL-authority tests are preserved verbatim under `test_case/historical/offline/world-sql-pre112/`. Retired assertions covered `wm` write locks, slot revisions, SQL outbox export, World-through-Settings summaries and WorldCommand recovery. Those paths must no longer be asserted as current behavior. Mixed files retain their independent Settings, log-search, transport, attachment and instruction tests in the active suite. Original versions remain in the historical directory for comparison; original SQL migrations are unchanged.

The offline synthetic model context window increases from 32,768 to 65,536 to cover the complete World reserve and batch-tool schema. Tests specifically about extraction segmentation pin their extraction-only budget; the main-loop log-slice fixture remains near its budget boundary. The 200-round 64 KiB integration fixture preserves all fixed anchors: its full World/tool/system floor is approximately 21.5k estimated tokens, above the 30% compaction target (16.2k) but below the 54k usable input budget. The test verifies the explicit target-not-reached reason and bounded requests instead of requiring deletion of mandatory context. This does not change any real provider's model limits.

## Acceptance boundaries

No persistent agile data or configuration is used. PostgreSQL acceptance uses a dedicated loopback cluster and disposable `secretary_test_*` databases. Synthetic startup evidence and review logs remain ignored. Native terminal gestures, a real provider, and Master's manual acceptance are separate from automated/API checks and are not implied by an automated PASS. Exact candidate SHA, held-out freeze/results, full verification, CI and reviewer disposition are recorded after their runs; no merge is authorized by this implementation task.
