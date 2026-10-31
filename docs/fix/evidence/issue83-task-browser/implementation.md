# Issue #83 implementation and evidence

Master approved R2 on 2026-10-31. The implementation adds the five planned read endpoints and a terminal Task browser. No merge or issue closure is authorized by this record. Master reported mechanical acceptance PASS on 2026-11-01 and requested the presentation follow-up below.

## Master presentation follow-up - 2026-11-01

Task cards now separate bold goal, plan/execution, attention, and time/result. Pink highlights actionable failures, authorization/decision items and unknown operations; blue shows active execution, amber waiting/queues and mint success. Text labels remain authoritative. IDs and timestamps are retained; detail lists attention/unknown-operation IDs. Bounded goal/result previews explicitly point to full detail. Only sanitized data receives trusted ANSI styling. Recent-three headers distinguish retention from message availability.

The #82/#83/#91 regression suite passed 131/131 with zero skips before the final detail-ID addition; its targeted follow-up and final full verify/CI are recorded in the PR. New checks cover terminal escape injection, plan/execution distinction, 80/120-column rendering, bounded previews and historical failure labels. Initial new-test type/argument mistakes are retained privately. A prior anchor fixture relied on an unbounded goal to force scrolling; it now creates twelve later scheduled tasks, preserving every anchor/draft assertion. A provisional full verify was stopped for the final tree freeze.

A fresh independent live domain uses the production backend and enabled pump, with opencode-go/deepseek-v4.1-flash for both roles and 8192-token output budgets. Actual provider responses, handled Main input, Main-created Task and successful Agent result are captured in [interactive model summary](interactive-model-summary.json). The initial probe misread the request envelope; the real conversation had already succeeded. It resumed without resending that input. No Store-seeded history is used for this instance. It remains running for Master; the new layout's native visual acceptance is pending. Final exact-head review and CI belong in the PR record.

## Implemented boundary

R6 follow-up review at `ae18b4a` found two presentation defects: historical cards lost their Scope label when no group header existed, and an expired deadline could produce a warning about a nonexistent next trigger. Both were reproduced before fixing. Historical cards now retain Scope/Shared explicitly; the warning requires an actual next due time and AT/INTERVAL trigger. Regression checks cover both historical label cases, unscheduled expired deadlines and actual scheduled deadlines.

The follow-up suite also exposed a premature assertion in the terminal anchor fixture: an API reply precedes Pi's queued layout, while xterm.flush only drains already queued writes. The test now waits up to five seconds for the actual restored anchor before making the same assertions, both after lookup and after back. The first failure is retained; no production anchor behavior changed.

The first final-tree local verify encountered `ECONNREFUSED`: the task-owned PostgreSQL cluster had been started on its default port rather than the test DSN's port. Its log is retained; the same cluster was restarted on the explicit test port and SQL connectivity confirmed before the new final-tree verify. No product/database logic was changed for this environment correction. The interactive live Core uses its separate filesystem domain. Its production model wrapper enforces request and final-payload budget guards, with both role output caps set to 8192; it has no unattended recurring acceptance task and stays running for Master.

- Whole authorized-set membership, global ordering and counts precede cursor paging. Shared uses `shared:null`; named NONE scopes remain ordinary. Scope/Execution creation times come from first journal mutation provenance. Per-task invocation/active/failure facts and proposal data are rebuilt incrementally; checkpoint-only revision churn does not invalidate ordering facts or list cursors. Time predicates run against `as_of`; `valid_until` drives refresh without writes.
- Attention and actionable-failure helpers are shared with existing consumers. PAUSED/CLOSED work cases are explicitly SEEDED tests. Historical search/completion excludes archived collisions and never inflates current counts. Every detail/message/content request rechecks visibility and ownership.
- Only durable `agent.message` events supply up to three execution conversations. Same-text events remain distinct. Actual user, assistant, tool and displayable reasoning content is paginated; redacted reasoning is omitted. Reads neither dispatch models nor mark executions viewed.
- The Task root and details share the existing Task draft. `/search_task`, `/taskdetail`, `/back`, `/M` and `/T` use stable IDs and source anchors. ID completion replaces only the token and rejects stale results. The single Main CoT mode applies to Task. Both pages share two concurrent reads; Task caps 200 message metadata / 4 MiB body and CoT separately from Main.
- Newest-three changes and archive responses remove stale bytes; navigation epochs prevent late reads resurrecting them. Bounded reverse paging retains the newly requested side. Rendering reuses #91 Markdown/source windows and caches components without copying full body text into version keys.

## R3 implementation review disposition

Claude reviewed exact head `421b559fd5ed3b5af3bf00efa5aae4d0ef4c7712` in the original Opus 5.5 Extra conversation and returned CHANGES_REQUIRED. It fetched/read the exact source and PR status but did not execute repository code. That head subsequently passed all three CI jobs and local PostgreSQL verify (850/850, zero skips); these do not erase the review findings.

- B1: an oversized Unicode grapheme no longer throws from a preview or content fragment. Ordinary graphemes stay intact; an exceptional cluster larger than the bounded lookahead uses lossless, surrogate-safe fragments. Regression checks restore oversized emoji-ZWJ and combining sequences in full, including reasoning and tool results, while list/lookup remain readable.
- B2: explicit search identity is separate from viewport restoration identity. No background refresh invents a search marker; scroll/refresh and reconnect retain the actual hit. Duplicate continued headers are hidden when their ordinary header remains in the loaded window (optional N3).
- B3: the shared failure predicate moved to execution-utils and restored linear per-call traversal. A deterministic 10,000-execution access-count regression rejects quadratic rescanning.
- B4: rows now label active creation/start, latest invocation provenance, execution end and the actual TaskResult observed_at. The new read DTO field is generated from the authoritative schema.
- Optional N4: locate reserves serialized historical-row bytes before bounding the current page. Reverse pages retain the nearest rows when the byte limit cuts a window; a 70-task large-preview test traverses every ID in both directions and checks locate payload size.
- Optional N6: L3's RUNNING and queue observations used a real Agent; the TASK_BUSY probe was a direct in-process Core scheduler.propose call, not a Main tool or HTTP request. The sanitized summary states this explicitly.

Optional N1/N2/N5/N7 (hidden-page refresh reduction, historical-row projection cost, effective latest-round goal presentation, and index memory reduction) remain improvement opportunities; they are not claimed as implemented. The revised #82/#83/#91 regression suite passed 128/128 with zero skips. The first added Unicode test initially attempted to revise an immutable TaskResult; its failure is preserved, and the fixture now seeds a fresh consistent result/execution pair without changing the production immutability constraint. Final-head CI and the follow-up Claude verdict are recorded in the PR comment.

## R4 message-window review disposition

Claude closed all four R3 blockers at `e4b31240af30dbc8283777ec1ec90be4053d542e`, then identified an older missed defect: message projection trimmed the newest end of an over-budget page even during backward paging. The supplied 120-message expanded-CoT regression first reproduced the lost anchor on that exact head; its red log is retained. That head independently completed local PostgreSQL verify (855/855, zero skips) and all three CI jobs; neither result overrides the new finding.

The correction trims the far end for the requested direction, recomputes the before cursor from the first retained event, and preserves the existing after rule. Serialized row sizes are counted once per pass rather than repeatedly serializing the whole window. The regression traverses all original event IDs without gaps through around-anchor requests, cursor requests and the actual TaskBrowserWindow, under the complete HTTP response byte cap. It also injects a discontinuous response: the client now keeps its original window and readable boundary marker and reports TASK_MESSAGE_WINDOW_GAP instead of silently merging it. The direct red/green check passed after the fix. Final-head complete verification, CI and the follow-up same-session Claude verdict belong in the PR comment.

## Validation and first failures

The focused #82/#83/#91 suite passed 120 tests before the final cache/navigation cases were added. The final added projection and window cases passed separately. Full PostgreSQL `npm run verify` and exact-head Linux/macOS CI are recorded in the PR final-head comment, so recording a verdict does not create another unreviewed commit.

Preserved private logs under `.demo-data/issue83/implementation/` include first TypeScript/DTO failures, old page-number assertions, a seeded-contract test setup error, and the reverse-window eviction regression. Assertions were updated for changed product semantics or corrected fixture construction; the reverse paging bug was fixed and now has an explicit advancement assertion. No source failure was normalized away.

[Sanitized live evidence](live-model-summary.json) records opencode-go / deepseek-v4.1-flash: 29 Main calls, 24 Task calls, 80 tools; all transport responses HTTP 200. Limits were registered before freezing model requests. Four real executions give exactly three visible groups. The newest has 66 actual events; final-source verification restores a real Assistant tool-call body of 7,599 characters. Positive displayable reasoning and an actual message without reasoning are both covered.

Two Main-created Shared tasks wrote separate `report.txt` files: 7,452 versus 25 bytes, distinct task cwd and SHA-256. A real missed-AT restart produced PAUSED without an execution. Quiescent browsing changed neither journal sequence nor model-call count; a controlled restart had its own startup journal mutation and did not rerun Agent work or change retention.

R1 genuinely failed at the 4096-token ceiling (`stopReason=length`, fourth Task FAILED). The first report is retained with its hash. R2 used a fresh domain and a preconfigured 8192-token normal/output ceiling; the production budget guard was never weakened. L3 passed only its intended RUNNING/queue/TASK_BUSY observation. Its Agent later reported FAILED because its write finished after the finite deadline; no successful recurring series is claimed, and queued work was not dispatched after capture.

## Native boundary and reproduction

HTTP plus actual recorded-data VirtualTerminal checks passed at 80×24 and 120×40. Native Terminal.app automation was refused by the computer-use tool (`com.apple.Terminal`). Physical Shift+Enter/Tab, native IME candidates, mouse selection and clipboard remain **NOT_TESTED**, pending Master. No browser TUI was used.

For the local preserved R2 domain, use two terminals from the repository root (the evidence-only server disables scheduler pumping and prohibits model calls):

```sh
npx tsx test_case/online/serve-issue83-history.ts .demo-data/issue83/live-r2
```

```sh
SECRETARY_DATA=.demo-data/issue83/live-r2/core npm run tui
```

Then `/T`, `/search_task 9dffed54`, `/taskdetail 9dffed54-37e2-4f17-966a-1cc69750e76b`, `/back`; toggle CoT only from Main. The rich Task draft must survive navigation and must never be sent. Exit each terminal with Ctrl+C. This local data is Git-ignored and contains only this isolated acceptance task.

AC33 remains partial: separate Shared cwd is verified; artifact listing, registered-only delivery, open/image UI belong to #94. #92 attention actions and #93 cancellation/failure disposition remain outside this change.
