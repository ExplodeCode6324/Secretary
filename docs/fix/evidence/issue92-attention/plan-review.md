# Issue #92 plan review / 计划复核

Date: 2026-11-02 (Asia/Hong_Kong). Status: CLAUDE_PLAN_PASS / AWAITING_MASTER_APPROVAL.

Master explicitly requested secretary-pr-fix plan scope, bilingual plans, browser Claude Opus 5.5 Extra, Master approval before implementation, and real-provider integration verification after implementation.

Baseline: origin/main `3a8a94ad93662fcfc2a889d9a2acbf1fe716343b`; branch `codex/issue92-attention-plan`. Claim recorded on issue #92. Product source/workflows/dependencies unchanged; unrelated evidence preserved.

[中文计划](../../fix_20261102_issue92_attention.md) · [English](../../fix_20261102_issue92_attention.en.md) · [Acceptance](acceptance.md)

Selected model verified in Master's existing Claude browser tab: Opus 5.5 Extra. A new issue-specific conversation is used; no fallback. Full English request and both plans will be supplied. Raw requests/replies/UI captures are Git ignored under `.demo-data/issue92/review/`; only sanitized conclusions enter repository documentation.

| Round | Verdict | Disposition |
| --- | --- | --- |
| R1 | CHANGES_REQUIRED | B1–B6 accepted; conservative B3 disposition and concrete optional-note handling in R2. |
| R2 | PASS (plan only) | B1–B6 closed; conservative B3 accepted, R1 continuation_of example withdrawn. Non-blocking notes incorporated. |

No implementation or runtime/native/live acceptance claimed. Plan PASS only permits handoff to Master for approval, under Master's explicit instruction and secretary-pr-fix phase 1 step 4.

R1 submitted `2026-11-01T19:15:22.320Z`; first read no earlier than `2026-11-01T19:25:22.320Z`. Session: https://claude.ai/chat/b9da0f21-c0b6-4bb1-8e7a-1ca6ad9b8597 . Both complete language versions supplied. Initial docs:check PASS (117 localization sources / 351 localized pages).

R1 first read after ten minutes: reviewer still running, no verdict. Next read follows the five-minute interval. Local source audit independently identified request_decision naming/options and Operation RESULT_UNKNOWN-vs-effect distinctions; held for R2 disposition rather than silently changing the submitted R1.

## R1 assessment and R2 disposition

Reviewer reports clone/checkout of exact base, read-only source inspection, verbatim reference v1.7, and issue via a paraphrasing web fetcher (not verbatim issue text). It executed no npm install, tests, Core, provider calls or terminal acceptance. Codex independently checked the issue verbatim with GitHub tools and verified cited source branches.

- B1 accepted: actual tool request_decision; options/deadline/display-change/foreign-session/volume branches explicitly SEEDED or scripted-provider. Main can answer via task_control: keep real Main without enough information, record its calls, and answered_by=MAIN cannot pass the MASTER-answer gate.
- B2 accepted: PENDING on ended/RETIRED execution remains Core-actionable but prominently warns that approval cannot resume the ended owner; no false execution claim or lifecycle rewrite.
- B3 accepted problem, conservative implementation choice: new Main failure projection retains every accessible FAILED Execution. Neither a newer execution nor continuation_of alone proves this failure was remedied; all historical failures are reachable with original times. #93 owns explicit disposition/retry association and eventual removal. No exception to C09 is requested; existing Task-browser membership remains unchanged. Reviewer asked to assess this stricter interim choice rather than assuming a parent link proves a successful retry.
- B4 accepted: state RESULT_UNKNOWN only; effect UNKNOWN on resolved objects excluded; execution fallback requires RESULT_UNKNOWN with no unknown operation; INIT_FAILED transition-based episode, TaskPlan attention mapping and coalesced/digest-guarded refresh.
- B5 accepted: current Delivery draft is authoritative, entry snapshot never overwrites a newer generation. Add accepted/cleared and restored-during-processing cases.
- B6 accepted: remove persisted envelope/schema change. In-memory same-ID retry during this process; restart inspects fresh object state without replay or old-request attribution. Domain guards prevent duplicate business effects. No recovery wizard or persisted unsent draft.
- O1 adopted immutable-key paging, simple current/adjacent-page window, no membership-digest reset/200-row subsystem. O2 stronger task-only ownership check shared across new projection and authorization detail/submission. O3 optional safe controlled UNKNOWN recovery, not mandatory dangerous fault generation. O4 existing pump:false hold explicitly named. O5 full focus/key/layout table and no /show ID completion. O6 material metadata/unavailable notice for seeded nonempty references. O7 known prompt-adjudication mismatch recorded outside #92. O8 budgets set before run to 48 Main / 48 Task / 150 tools (8192 output, 90 s request, 20 min total); first failures retained.

R2 docs:check PASS. No product implementation has begun.

R2 submitted `2026-11-01T19:34:17.590Z`; first read no earlier than `2026-11-01T19:44:17.590Z`. Same Claude session, both complete revised plans.

## Final handoff

R2 read at 2026-11-02 03:44 HKT, after the required ten-minute boundary. Exact verdict: **PASS (plan only)**, “No blocking corrections remain.” English/Chinese materially consistent. Reviewer rechecked the exact baseline, resume/dispatch/FAILED producers, write tool and CoreClient with read-only grep/sed; no tests/Core/provider/terminal executed. Issue remains reviewer-paraphrase-only; Codex read its verbatim connector body.

Final non-blocking dispositions: show latest region window at rest and enter its bottom row, preserve short history access with >100 matters, test history-bottom Down/height changes; use TaskResult creation frame for actual FAILED provenance; isolate seeded Core with pump:false and no live credentials; correct the ownership fact and document existing-route tightening; register rejection-caused failure rows and historical failures/Task-vs-Main visibility differences; leave INIT_FAILED retry/journal growth outside this batch. Reviewer explicitly accepted retaining all failure rows until #93 supplies authoritative disposition association and withdrew its R1 parent-link example.

Master-facing implications are in both plans: rejection may cause a persistent failure row; historical failures appear (seen resets on restart); older failed executions remain readable via Main even when Task's current set/latest-three history omits them. No implementation started. Remaining gates: Master plan approval, code/CI, mandatory real-provider L1–L4, physical native acceptance, same-session exact-head Claude implementation review, explicit merge decision and issue closure.

Raw evidence: `.demo-data/issue92/review/r1-request.txt`, `r1-response-dom.txt`, `r1-verdict.png`, `r2-request.txt`, `r2-response-dom.txt`, `r2-pass.png`, timing and structural-check files. Session retained: https://claude.ai/chat/b9da0f21-c0b6-4bb1-8e7a-1ca6ad9b8597 . Final local plans incorporate only the review's non-blocking notes after R2 PASS.

Final validation: npm run docs:check PASS (646 Markdown files, 8477 local links, 117 localization sources/351 pages); bilingual structural checks PASS. Structural checks are not a substitute for semantic review. Only the four issue92 plan/evidence documents are committed; no product source, dependency or workflow changes.

## Conditional approval and classification addendum

Master approved implementation on 2026-11-02, requiring separate failure categories while #93 retains exact disposition/removal. Claude Opus 5.5 Extra returned PASS for the narrow addendum, submitted 19:59:10 UTC and first inspected 20:09:16 UTC. Same conversation; baseline source inspection only, no execution.

Accepted correction: resumeAuth can encounter CANCELLED operations caused by RULE_CHANGED, so its old reason string alone does not prove rejection. The new detail marker describes cancellation on resume, not denial. Classification validates the FAILED result, exact recorded branch evidence, reciprocal Operation/Authorization ownership, MASTER_UI decision identity, matching cancellation/decision frame, and a decision sequence strictly before the failure frame. Linked rejected facts without cause evidence remain execution_failed. Inconsistent evidence is explicit; unavailable historical provenance stays unclassified as approved. REVOKED has a separate label and actual state.

Known Core behavior remains outside #92: the broad CANCELLED resume branch can fail after a rule change. This issue truthfully labels that inconsistency and does not alter the state machine. Raw addendum request/reply/screenshot remain ignored under `.demo-data/issue92/review/approval-addendum-*`.
