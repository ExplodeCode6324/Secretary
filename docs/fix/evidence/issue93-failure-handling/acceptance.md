# Issue #93 acceptance ledger

All implementation gates are NOT_TESTED at plan creation, 2026-11-02.

| Gate | Status |
| --- | --- |
| Bilingual plan / Claude review | PASS_PLAN_ONLY / R3 PASS |
| Master implementation approval | GRANTED — Master: “通过，可以实施。” (2026-11-03 HKT) |
| A1–A8 / AC21, AC29 and regressions | NOT_TESTED |
| L1–L4 real-provider/Core evidence | NOT_TESTED |
| Native Terminal / Master manual acceptance | NOT_TESTED |
| Implementation CI / same-session Claude review | NOT_TESTED |
| Master merge authorization / merge / post-merge CI | NOT_GRANTED / NOT_DONE |

Separate fixture, seeded Core, controlled faults, actual provider calls and physical manual evidence. Preserve failure keys and all business IDs with exact source SHA. Prior #83/#92 runs do not prove #93. Neither accepted receipts nor a model's verbal claim proves cancellation or disposition.


Plan completed 2026-11-03 HKT. Claude R1 and R2 requested changes; R3 PASS confirms the revised plan and bilingual parity only. Documentation/link/localization and staged-diff checks pass. Source/CI/provider/native acceptance remain NOT_TESTED for #93. Master approval must include historical failures affecting current Task counts, direct-link-only resolution, FAILED/CANCELLED feedback batch isolation/model-call cost, and the deliberately unchanged EXPIRED feedback behavior.

## Implementation progress — 2026-11-03 HKT

Master explicitly approved implementation. Core now admits an isolated failure Input, FailureHandling and API receipt together; the Scheduler admission and redo link share one frame. Failure membership is shared by attention, Task browser and activity. TUI failure actions use Main; Task cancellation uses exact existing cancellation routes. Main drafts retain their original delivery ownership.

Initial full verification exposed two prompt-capacity regressions and two expected UI-contract changes. Detailed failure instructions were moved to failure-bound prompt snapshots, keeping ordinary context small; the original 200-round compaction and Settings assertions pass unchanged. Command completion now includes `/cancel`; presentation assertions now require unresolved failure counts. No capacity limits were relaxed.

Real provider attempt 1 used opencode-go / deepseek-v4.1-flash. L1 passed genuine missing-input failure, predeclared input-file repair, Main redo admission, successful directly linked execution and registered artifact byte/hash verification. TaskResult still honestly reports NOT_VERIFIED. L2 reached genuine repeated failure, explicit dismissal, restart persistence and a further same-task failed execution, but its final feedback hit the approved 14-Main-call case limit. The run stopped at 26 Main / 12 Task calls, 25 total generated tool calls. L2 is NOT_COMPLETED, not PASS; L3 and L4 were not run. The raw ledger remains cumulative; an additional Main allowance has been requested from Master and is not presumed granted. Historical per-case tool counters conservatively overcounted overlapping responses; the aggregate tool count is authoritative and the harness now counts each returned response directly.

L1 was run before the subsequent prompt-scope, deadline-prediction, optional result-evidence identity and rejected-cancellation UI polish. Raw source hashes distinguish that evidence from the final source. A final-head live rerun is not claimed.

Native Terminal access was rejected by the computer-use tool's automatic safety review (`com.apple.Terminal` unavailable). The dedicated seeded server was stopped. Native keyboard/IME/clipboard and Master's manual acceptance remain NOT_TESTED; VirtualTerminal is separate evidence. UNKNOWN/retired/foreign-owner read checks run credential-free with pump disabled.

Current acceptance status remains conditional: complete final verification/CI, same-conversation Claude implementation review, remaining live gates within approved budget, and Master manual acceptance. No merge is authorized.
