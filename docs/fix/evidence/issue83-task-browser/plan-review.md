# Issue #83 plan review / 计划复核

Date: 2026-10-31 (Asia/Hong_Kong). Status: CLAUDE_PLAN_PASS / AWAITING_MASTER_APPROVAL.

- Master requested secretary-pr-fix, bilingual plan, browser Claude Opus 5.5 Extra, explicit approval before implementation, and real-model integration verification after implementation.
- Issue #83 assigned to authenticated repository owner `ExplodeCode6324`.
- Latest main verified through GitHub branch API: `c394866c772833ad1de6fac342afe5700665c95f` (PR #96); local branch `codex/issue83-task-plan`. Existing tracked source matched the merged tree. Unrelated untracked evidence preserved.
- Initial git fetch failed with HTTP/2 framing error; bounded HTTP/1.1 retry failed with SSL_ERROR_SYSCALL. GitHub connector successfully verified main; the commit already exists locally. Neither failure changes the implementation or acceptance state.
- Claude selected UI reads `Model: Opus 5.5 Extra` in a new issue-specific conversation opened from Master's existing Claude tab. No fallback.
- Raw evidence location: Git-ignored `.demo-data/issue83/review/`. Repository records contain sanitized conclusions only.

[中文计划](../../fix_20261031_issue83_task_browser.md) · [English](../../fix_20261031_issue83_task_browser.en.md) · [Acceptance](acceptance.md)

| Round | Result | Disposition |
| --- | --- | --- |
| R1 | CHANGES_REQUIRED | Accepted B1–B4; R2 removes cross-Task followup membership, grounds schedule/attention/failure rules, labels unreachable paused/CLOSED combinations SEEDED, and scopes uniqueness to browsable IDs. O1–O9 adopted as bounded implementation clarifications. |
| R2 | PASS | B1–B4 closed; EN/ZH materially consistent. N1–N5 non-blocking notes incorporated; reviewer explicitly says no R3 needed. Ready for Master plan approval only. |

The approval gate comes directly from Master's instruction and secretary-pr-fix phase 1 step 4. Plan review PASS does not itself authorize implementation or merge. Reviewer-read code and reviewer-run checks will be recorded separately from Codex-provided evidence.

R1 submitted at 2026-10-31 16:26:23 HKT (08:26:23 UTC); first read not before 16:36:23 HKT. Same review session: https://claude.ai/chat/e575506d-98f9-48d7-92ba-90fd16b619c7 . Full English and Chinese plans supplied in one request.

Planning validation: npm run docs:check PASS (117 localization sources / 351 localized pages); bilingual structural check PASS (9 sections, A1–A7 and L1–L4 in both languages, same base, no trailing whitespace). Structural consistency is not a semantic review. Product source, dependencies and workflows remain unchanged; runtime/native/live/CI acceptance is NOT_TESTED.

## R1 findings and R2 disposition

R1 first read after ten minutes was still running; second read after five more minutes returned CHANGES_REQUIRED. Raw reply and screenshot preserved. Reviewer independently fetched issue/main/reference and inspected the exact baseline source. It reports **no tests executed**: repository execution was blocked by its own session permission policy; Pi submodule was not fetched. Its conclusions are source review, not runtime/native/live verification. Codex checked the cited followup, trigger, continuation, recovery, attention and failure branches locally.

- B1 accepted: pending_followup_ids can belong to another task; remove this independent membership reason. Same-Task pending_requests already count.
- B2 accepted: supported schedule fields only; no working EVENT inferred from enum, IMMEDIATE uses pending_requests. Attention maps actual request/Execution predicates; latest-created FAILED remains actionable until superseded. Register display-only deadline eligibility. Codex makes the recommendation precise as `deadline > max(as_of,next_due_at)`, excluding an already-expired overdue occurrence as well as one due at/after deadline; tick remains unchanged and real queued/nonterminal objects still count.
- B3 accepted: paused-with-work and CLOSED-with-work are SEEDED projection cases, not publicly producible/native claims at this base. Real paused-without-work uses missed-AT recovery. Explicit acceptance ledger rows added; no new public control API.
- B4 accepted: exact/prefix uniqueness over the complete browsable set excluding archived tasks. Add one-visible/one-archived prefix collision case.
- O1–O9 adopted: ID grammar/token-only completion, stable list-key/count digest (not every checkpoint revision), parameterized existing body path/Message DTO where compatible/redacted-thinking helpers, shared small predicates, incremental rebuildable projection, readable RETIRED events without viewed writes, finite live budgets/deadline plus stopping the isolated Core, TASK_BUSY/QUEUE expectation, Shared sentinel and historical result placement, explicit UNKNOWN tier and shared two-read limiter.

Both languages remain materially aligned. No changes to product source, dependencies or workflow; implementation/native/live evidence stays NOT_TESTED. Master approval is still required.

R2 submitted 2026-10-31T08:45:10.040Z; first read not before 2026-10-31T08:55:10.040Z. Both complete revised language versions and B1–B4/O1–O9 dispositions sent. R2 docs:check PASS.

## Final handoff / 最终交付

R2 read after the ten-minute boundary at 2026-10-31 16:55:11 HKT. Exact verdict: **PASS**; “R2 is ready for Master’s plan approval.” All B1–B4 closed. Reviewer explicitly agreed with `deadline > max(as_of,next_due_at)`. No R3 required for its non-blocking notes.

N1–N5 accepted in both plans and ledger: (1) still-valid authorizations on ended executions keep the task current, mirroring existing attention, with no #83 disposal; (2) valid_until includes plan deadlines, time conditions evaluated at query as_of with scheduled refresh; (3) FAILED membership independent of RETIRED/object availability; (4) missed-AT recovery produces an extra Main model turn, budgeted and classified as background; (5) interval/deadline choice plus finite budgets and stopping isolated Core contain queued work. Codex checked the cited authorization creation, completion, reportMissed and Main scheduler-input source paths.

R2 reviewer read revised text and four additional baseline source areas. **No code or tests executed by reviewer in either round.** No product/runtime/live/native work performed by Codex in this plan-only stage. Raw text, DOM, timing and PASS screenshot: `.demo-data/issue83/review/r2-*`. Session for later exact-head implementation review: https://claude.ai/chat/e575506d-98f9-48d7-92ba-90fd16b619c7 . No fallback model/provider.

Approval remains pending directly under Master's request. Implementation, exact-head CI, mandatory real-model integration, native/manual acceptance, final Claude code/evidence review, merge authorization, post-merge CI and issue closure remain separate gates.
