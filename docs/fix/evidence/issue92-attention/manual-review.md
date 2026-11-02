# Issue #92 Master manual acceptance follow-up

2026-11-02. Initial tested source: `10b287dbeb8c61a1ef0f799f71b793e9e62faab8`. The independent manual instance used SEEDED_CORE, pump disabled and no live provider. Initial totals: 44 matters, 3 authorizations, 4 questions, 36 failures, 1 UNKNOWN. Earlier live-provider results remain separately scoped.

| Item | Master report | Disposition |
| --- | --- | --- |
| 1 | Reported the expected header counts | Counts observed; no additional acceptance inferred |
| 2 | PASS; asks Up at first to wrap to last, Esc alone to leave selection | Adopt whole-list circular arrows, retain bounded page rows, cancellation and original identity on errors |
| 3 | PASS | Failure category display accepted in this seeded instance |
| 4 | Detail Esc returns to editor; asks return to current selection | Adopt two-stage Esc: detail to same selected item, then selection to editor; no stale-row resurrection |
| 5 | PASS | Draft preservation accepted for exercised steps |
| 6 | Could not find Main question | Snapshot shows it already ANSWERED with literal Chinese text. Exact requested multiline/IME procedure is still NOT_VERIFIED; supply a fresh question |
| 7 | Could not find options question | Snapshot shows it already ANSWERED with Chinese text. Option-copy procedure is still NOT_VERIFIED; supply a fresh question |
| 8 | CONDITIONAL_PASS; approval needs emphasis | Add bold yellow approval focus and explicit Shift+Enter confirmation wording; retain neutral initial focus and no Enter action |
| 9 | Success | Rejection confirmed by stored REJECTED state |
| 10 | `/show` says draft preserved | Local snapshot confirms entire command is a paste block. Preserve intentional paste-as-text semantics; explain manual command entry in the message and instructions. Stored question answer `/m test1` is evidence of a literal answer, not proof of this command attempt |
| 11 | Could not find format-character question | Still OPEN; provide direct identification in the refreshed fixture; NOT_VERIFIED |
| 12 | PASS | Master accepted the exercised size/reconnect steps; no inference about other IME/clipboard cases |

The navigation revision replaces the earlier top-edge-to-history rule. Ordinary-editor PageUp reaches history independently of attention selection. Main history Down still returns to attention selection. Task-origin detail return is unchanged. Authoritative removal/expiry may still clear an invalid selection and show a notice; it never silently selects another item.

Follow-up source changes are confined to TUI presentation/navigation and explanatory help. No Core authorization, answer, model dispatch or failure classification predicate changes. Fresh manual data must remain a separate domain; preserve the previous answers, drafts, failures and first test failures.

Verification and exact follow-up head, CI, same-session Claude Opus 5.5 Extra verdict and remaining Master acceptance are recorded in [PR #99](https://github.com/ExplodeCode6324/Secretary/pull/99). A previous head's PASS does not cover this revision; merge and issue closure remain unauthorized.

Master subsequently requested raising the inline paste threshold from 30 to 60 graphemes. Adopted after the navigation fix; existing tests now cover 30/31 and 59/60/61 boundaries with ASCII, Chinese, combining marks, family emoji and flags. Multi-line/Tab folding and paste-as-text command semantics remain unchanged.

Local follow-up checks: 35/35 focused issue92/paste tests pass; the completed real-provider domain passes the read-only recheck with both failure causes preserved, zero provider calls and unchanged business/retention state. The first two navigation runs failed because Pi intercepted PageUp before the app listener; the app now explicitly owns page-key routing, and the unchanged history-entry assertion passes. Broader regression and exact-head CI results follow in the PR.

## Final manual report and conditional Ctrl+C extension

Master subsequently accepted 2/4/6/7/8/11, then 10 and 13. The initial NOT_FOUND used an actual TaskPlan ID with /show; the correct DecisionRequest ID opened successfully and Master completed its answer. These manual results cover the exercised seeded UI, not additional provider or unrelated native scenarios.

Master explicitly authorized adding Ctrl+C clear with undo, completing tests and same-session Claude review, then merging. Nonempty visible Main/Task input or temporary question answer is cleared in one undoable edit; empty/no-editable-answer Ctrl+C closes only TUI. Hidden ordinary drafts and immutable pending request envelopes are preserved. Key release events are ignored. This shortcut has new automated coverage; no new physical-key PASS is claimed.
