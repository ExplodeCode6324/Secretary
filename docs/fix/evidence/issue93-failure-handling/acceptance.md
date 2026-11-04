# Issue #93 acceptance ledger

All implementation gates are NOT_TESTED at plan creation, 2026-11-02.

| Gate | Status |
| --- | --- |
| Bilingual plan / Claude review | PASS_PLAN_ONLY / R3 PASS |
| Master implementation approval | GRANTED — Master: “通过，可以实施。” (2026-11-03 HKT) |
| A1–A8 / AC21, AC29 and regressions | PARTIAL — 22 focused offline cases; product/manual matrix incomplete |
| L1–L4 real-provider/Core evidence | PARTIAL — L1 passed on recorded source; L2/L3 budget-blocked; L4 not run |
| Native Terminal / Master manual acceptance | TOOL_BLOCKED / NOT_TESTED |
| Implementation CI / same-session Claude review | IN_PROGRESS / PENDING |
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

A second fresh domain exercised L3 within its original allowance. The periodic real Agent entered WAIT_DECISION, exact execution cancellation reached CANCELLED, and TaskPlan next_due_at/state stayed unchanged. The authorization branch then exhausted L3's 14 Main calls before completion; its Agent attempted read-only `pwd && ls -la`, so a completed direct-write path is not claimed. L3 remains NOT_COMPLETED. Cumulative provider usage is 40 Main / 14 Task / 32 generated tools. L4 remains NOT_RUN. No additional budget has been presumed approved.

Native tooling blocked access before any Terminal UI action. The seeded server was stopped; no native UI PASS is claimed.

Final code audit also retained original cause text across detail refresh and limited optional goal strictly to REDO inputs. The persisted-Input schema is verified across restart; ordinary and DISMISS contexts still require goal. Sanitized live reports include hash-verified journal identities/state transitions and ModelCall IDs; these are observations, not claims that incomplete live gates passed.

## Implementation review I1

Claude Opus 5.5 Extra fetched and inspected exact PR head `1e0f39457e6b120cad831113a6d3a285bb1d84ee` in the same plan-review conversation. Verdict: CHANGES_REQUIRED for C1; product/merge NOT_READY. It reviewed the changed Core/TUI sources and dependent continuation/admission code, but did not execute tests (its npm installation was permission-blocked). Provider observations remain Codex-supplied evidence.

C1 accepted: argument/tool/target/intent/requirements errors retain a per-call durable rejection receipt and the latest error, while the same claimed Main intent can correct its next call. Only admitted work, continuation refusal or dismissal settles that intent; empty materials add nothing. Regression coverage proves correction after restart, old rejection replay and a single admitted redo. No new paid run or budget reset accompanied this fix.

Non-blocking findings also addressed: normalize legacy source references with the same filtering and de-duplication used by continuation; compute unresolved membership without full detail/blocker scans; allow fingerprint-checked replay of an existing Scheduler receipt from a pre-upgrade terminal-feedback batch, while blocking new proposals. Tests cover legacy successful redo, read-only membership scan bounds and actual Host recovery across restart.

UI deviations corrected to match the approved plan: confirmed Input admission returns to Main and its original draft (not a claim that the business action completed); dismissal wording states that other work/future schedules continue; cancellation reads its exact target before first submission and shows the request removal reason when present. Explicit same-ID retries preserve their envelope.

I2 must review the resulting new head, followed by exact-head Linux/macOS CI. Fresh final-source L1 and remaining L2–L4 are still required, as is native acceptance. The original cumulative wall-clock window has expired in addition to exhausted per-case Main budgets; any further provider run requires Master’s explicit revised allowance for both calls and time, with all prior usage retained.
