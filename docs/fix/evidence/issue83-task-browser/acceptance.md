# Issue #83 acceptance ledger / 验收台账

2026-10-31. Master approved R2 implementation. 已实施并完成真实模型验证；精确 HEAD CI 和同会话 Claude 结论在 PR 终审记录中核对。

Plan base: `c394866c772833ad1de6fac342afe5700665c95f`; implementation SHA: see PR exact-head verification record (no automatic merge).

[中文计划](../../fix_20261031_issue83_task_browser.md) · [English](../../fix_20261031_issue83_task_browser.en.md) · [Review](plan-review.md)

| Gate | Status | Required evidence |
| --- | --- | --- |
| A1 current set / global order / counts | PASS / OFFLINE CORE | Full dataset and real Core comparison; ordinary scopes=4, Shared=3, archived=2; account for latest FAILED and cross-Task parent rules |
| A1s paused/CLOSED with work | PASS / SEEDED ONLY | Not producible via public flows at c394866; isolated Store projection tests, explicitly not native/live proof. No new pause/close API. |
| A1r paused without work | PASS / LIVE CORE | Real missed-AT controlled restart; no current membership |
| A2 ID / archive exclusion | PASS / OFFLINE + REAL-DATA READS | Full/prefix/ambiguous/history/archive, all browse routes and in-flight archive; one visible + one archived prefix collision resolves visible |
| A3 latest three Agent executions / anchors / draft | PASS / LIVE + VIRTUAL TERMINAL | Four actual executions, long conversation/body pages, fewer/program cases, no fourth entry |
| A4 shared Main CoT | PASS / LIVE + OFFLINE | #91 inheritance, available/absent reasoning, late pages, Task-local error |
| A5 same-Task busy boundary | PASS / LIVE CAPTURE; later FAILED deadline outcome recorded | Real active execution + scheduled INTERVAL queue + TASK_BUSY continuation rejection, Core/TUI agreement |
| A6 Shared cwd / AC33 partial | PASS / LIVE | Real Main → two Agent tasks → different cwd/report.txt bytes |
| A7 native input / read-only behavior | READ_ONLY PASS; NATIVE NOT_TESTED | Native IME/completion/keys/errors; quiescent journal/model-call comparison |
| L1 real Main → Agent history | PASS / LIVE | Actual provider/model, IDs, event identity, paging markers and transport outcomes |
| L2 real Shared work | PASS / LIVE | Actual directory and file evidence, not model self-report |
| L3 real busy / displayable CoT | PASS / LIVE CAPTURE | Observed real execution/queue and positive/absent CoT branches |
| L4 real-data read-only / reconnect | PASS / LIVE RECORDED DATA | Same records, no redispatch or retention writes |
| Focused tests / full verify / exact-head CI | FOCUSED PASS; final full verify / CI in PR record | Implementation commit and first failures preserved |
| Claude exact-head implementation review | PENDING / SAME SESSION | Same session, exact SHA, actual evidence scope |
| Master acceptance | MECHANICAL PASS REPORTED; NEW LAYOUT PENDING | Master reported mechanical acceptance on 2026-11-01; individual IME/clipboard subchecks were not separately attributed |
| Merge authorization / post-merge CI / closure | NOT_AUTHORIZED / NOT_TESTED | Separate explicit decisions and results |
| AC33 artifact listing / registered-only delivery / open | OUT_OF_SCOPE_94 | Do not mark entire AC33 passed |

Before execution register OS/Terminal/Node/pi-tui versions, font/IME, sizes 80×24 and 120×40, actual input/exit keys, tested SHA, isolated domain identity and sanitized provider/model. Each row must link its own real object IDs, operations, observed result and private/public evidence locations. Source review, mocked transport, seeded fixtures, PTY and native input remain distinct evidence classes. Preserve first failure before any retry. No secrets, credential-bearing endpoints or unrelated personal data in published evidence.


R2 review reminders: a valid PENDING/APPROVED authorization on an ended execution still counts under current attention semantics; FAILED membership does not depend on retention/object readability. Include plan deadline expiry without a sync event. Budget missed-AT recovery's real Main turn and mark its writes as background. Use finite interval/deadline/call limits and stop isolated Core to contain queued live work. Implementation outcomes are recorded in the linked evidence and PR record.

Implementation detail, evidence classes, first failures and native reproduction: [implementation record](implementation.md) and [sanitized model summary](live-model-summary.json). Master reported mechanical acceptance PASS on 2026-11-01. The subsequent structured/pastel layout awaits Master testing in the new interactive live instance; see [interactive model summary](interactive-model-summary.json).
