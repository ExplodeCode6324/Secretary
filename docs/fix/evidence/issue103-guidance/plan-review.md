# Issue #103 plan review

## 2026-11-06 — Initial R1 submission observation (historical)

- Master authorized planning and browser Claude review only, followed by explicit implementation approval.
- Issue #103 assigned to the authenticated repository owner. Baseline is `f22e85f01e2f8704c0b2e61ee5fb8504a5e6d7c2`, matching remote main and PR #102 merge.
- Bilingual plans: [Chinese](../../fix_20261106_issue103_guidance.md), [English](../../fix_20261106_issue103_guidance.en.md).
- Existing Claude browser page visibly identifies **Opus 5.5 Extra**. The complete English request is entered in its composer. Sending by button and Return has not produced a sent message; the composer remains populated. Native screenshot is black; browser inventory reports local browser use disabled in Work settings. No account/model-access failure was observed.
- Master was asked to wake/unlock the Mac and send the already populated request. Do not claim R1 submitted or start the ten-minute review waiting interval before confirming actual submission. Do not switch reviewer/provider.
- Raw request, issue snapshots and UI observations are under ignored `.demo-data/issue103/review/`. The filename `r1-submitted-ax.txt` records an attempted submission, NOT successful transmission; its contents and `r1-submit-check.txt` show the text still in the composer.
- Local document links/UTF-8/newlines checked. No tracked product, contract or test modification. Implementation tests, live-provider tests and native product acceptance: NOT_RUN.
- At that handoff, submission/review remained unconfirmed. The later observation below supersedes this status; the original failed-confirmation evidence is retained.

## 2026-11-06 17:49 HKT — R1 observed complete

After Master reported the Mac unlocked, the same conversation visibly contained the submitted full R1 request and a completed CHANGES_REQUIRED response, each labelled about six hours old. Exact transmission time and whether a delayed action or human submission completed it are not established; do not rewrite the earlier observation as confirmation at that time.

Reviewer independently inspected the pinned Secretary baseline and upstream Pi commit 16787ad (the submodule was absent in its checkout), confirming the relevant hooks and admission/recovery seams. It did not run tests or real-model acceptance. Issue descriptions were seen through its summarizing public-page fetcher; Codex had fetched the actual issue text through the GitHub connector. PR #102/CI and prior acceptance facts were supplied, not independently verified by this reviewer.

| R1 finding | Codex disposition in R2 |
| --- | --- |
| Steer before recovery continue places new guidance ahead of a response that never saw it | Accepted: explicit recovery phase outside Pi queue until finishTurn, including text-only recovery and error/wait exits. |
| Repeated active-requirements packet duplicates text and can retain stale copies | Accepted: single-copy dispatch/steer text, persisted-request consumption evidence, no repeated full-text packet. |
| Existing Main answer path can clear Master-only conflict waits | Accepted: optional required_answerer set by host; enforce in shared answer() and expose in existing attention display. |
| WAIT_AUTH denial/reuse semantics underspecified; reviewer proposes auto-withdrawal and READY | Agree gap, choose scoped alternative: preserve pending wait and actual denial failure; after approval retire stale never-started operations, then replan with ordinary authorization. Auto-withdrawal contradicts the issue's no-release-of-wait requirement, so not adopted without a product change. Returned to reviewer for judgment. |
| Smaller mechanisms and boundary coverage | Accepted: steeringMode all, checkpoint-based RECEIVED (waiting without Agent stays SENT), one durable refusal counter, 20-call-cap test, existing shell not_started path, shared error/Feedback-ID vocabulary. |

Raw R1 reply: ignored `r1-response-dom.txt`. Prior bilingual plan copies retained as `plan-r1.*.md`.

## 2026-11-06 17:54:10 HKT — R2 submitted

The full revised English plan and finding-by-finding rationale were sent in the same Opus 5.5 Extra conversation. UI confirmed message 17/18 and “Claude is responding”; submission time `2026-11-06T09:54:10.865Z`. First read no earlier than 18:04:10 HKT; later reads five minutes apart if needed. Raw `request-r2.txt`, `plan-r2.en.md`, `plan-r2.zh.md`, `r2-submit-ax.txt`, and `r2-submitted-at.txt` are ignored.

Awaiting plan verdict. No product/schema/test implementation or live-provider acceptance has been performed. Master approval remains pending.

### Requirement coverage check during R2 wait

All rows are planned coverage, not executed acceptance.

| Issue #103 acceptance | Plan location / evidence to collect after approval |
| --- | --- |
| Shared API/Main entry, identity conflicts, atomic Main information | §2 and §6 admission/crash tests |
| Three stages with real call and adoption proof | §3–4, false-receipt and cross-call/execution tests |
| Interrupted delivery/reception recovers without loss/duplicate consumption | §5.1–2 and §6 crash matrix |
| Frozen calls/responses cannot certify new guidance or finish successfully | §5.2–3, §5.7; PREPARED/IN_FLIGHT/RESPONSE_SAVED cases |
| Sequential-tool, WAIT_AUTH and WAIT_DECISION boundaries | §5.3–6; rejection/approval/unknown-effect and Master-only-answer tests |
| Admission/success ordering, terminal outcomes, PROGRAM and ownership errors | §3, §5.7–9; both commit orders and terminal settlement |
| Ordinary receipt silence, unique coordination, unknown-effect no replay | §2/4/5; Main Input/Feedback identity counts |
| Controlled real model changes later behavior | §6 isolated mid-execution restriction and separate persisted-call/result checks |

Document-only validation after R2: `npm run docs:check` PASS (684 Markdown files, 8749 local links, no errors; localization current: 119 sources / 357 pages / 710 units). Bilingual R2 hashes are preserved in ignored `r2-plan-manifest.json`. This does not establish type correctness or implementation behavior.

## 2026-11-06 18:04 HKT — R2 verdict and R3 disposition

R2: CHANGES_REQUIRED, one blocker. Reviewer accepted preserving pending authorization and denial failure, withdrawing its automatic-withdrawal suggestion. It directly inspected baseline execution-runner/effects and the pinned upstream Pi; issue quotations and local execution status were supplied, not independently verified.

R3 accepts the resume-loop race: recheck synchronously before each write/shell dispatch, retire current/remaining obsolete never-started authorized operations, stop applying and replan via an explicit non-error outcome. No guidance exception may reach the generic FAILED catch. Retain the separate proven launcher-window not_started path. Add the between-approved-operations race tests. Also accept all three non-blocking recommendations: approval-time explanation, late guidance atomic settlement with MISSING_STRUCTURED_RESULT, and one public retirement presentation with distinct underlying evidence. Raw reply: ignored `r2-response-ax.txt`.

## 2026-11-06 18:08:11 HKT — R3 submitted

Full English R3 submitted in the same conversation after verifying Opus 5.5 Extra. UI confirmed message 19/20 and responding. Submission time: `2026-11-06T10:08:11.988Z`; first read no earlier than 18:18:11 HKT. Request and submitted-state evidence are ignored under the review directory. Awaiting verdict; implementation approval remains pending.

R3 document-only validation: `npm run docs:check` PASS (684 Markdown files, 8749 local links; 119 sources / 357 localized pages / 710 units current). R3 snapshots and hashes are preserved in ignored `r3-plan-manifest.json`. Tracked product diff remains empty. Codex also re-read the resume loop and effect boundaries: the actual baseline orders writes before shells; the underlying between-awaited-operations race remains valid, and planned tests must use executable operation order rather than copy the reviewer’s illustrative shell-then-write ordering.

## 2026-11-06 18:18 HKT — R3 PASS, awaiting Master

- First read `2026-11-06T10:18:29.374Z`, more than ten minutes after submission. Same [Claude conversation](https://claude.ai/chat/14cf8a15-0d9c-47eb-897a-c1928865a382), Opus 5.5 Extra confirmed before sending. Completed message 20/20 returned **PASS (the plan is ready to implement)**, no remaining concrete blocker.
- Reviewer verified the per-operation synchronous check/non-error outcome, and independently checked pinned Pi's Agent state update before message_end subscribers, supporting checkpoint-based RECEIVED. It inspected Secretary baseline source and matching upstream Pi; quoted issue requirements, local status and validation facts were supplied, not independently verified. No reviewer-run implementation/behavior acceptance.
- Implementation watch points retained: durable Operation/ModelCall provenance at auth.prepare, deferred path must reach READY/dispatch, and only genuine host supersessions bypass cancellation failure.
- Master decisions remain: pending authorization does not release; approval retires obsolete operations and replans, actual denial fails; 16,384 UTF-8 bytes per instruction, 64 accepted instructions and 65,536 total bytes per execution; three unique responses attempting premature success lead to GUIDANCE_NOT_PROCESSED.
- Raw reply `r3-response-ax.txt`, request, submitted state, timestamps and reviewed bilingual hashes remain ignored. Final plan edits only record verdict/dispositions and clarify existing implementation checks; reviewed R3 content is preserved unchanged in snapshots.
- Product implementation, product tests, live-provider acceptance, native terminal acceptance, PR/CI and merge: **NOT_RUN**. Only bilingual planning/review and document validation were performed. Master implementation approval is still pending.

## R4 — Master product rulings

Master accepted WAIT_AUTH, confirmed hard over-limit rejection, and replaced the three-response grace counter with mandatory consumption. In explicit clarification, Master confirmed next permitted fresh request inclusion and immediate failure on an attempted successful finish without valid processing; authorization waiting and active CANCELLED remain unchanged. A first-response disposition deadline was offered but not chosen. R4 updates both plans, removes the counter from normative requirements/tests, preserves historical review records, and returns to the same Claude reviewer.

R4 submitted in the same Opus 5.5 Extra conversation at `2026-11-06T10:37:22.286Z` (18:37:22 HKT), UI message 21/22 and responding. First read no earlier than 18:47:22 HKT. Document check PASS: 684 Markdown / 8749 local links; 119 sources / 357 localized pages / 710 units current. Raw request, snapshots, hashes and submission evidence remain ignored.

## R4 observed 18:47:48 HKT — CHANGES_REQUIRED; R5 disposition

Reviewer accepted mandatory consumption but found delayed admission-to-steer and reversed success/receipt ordering could falsely fail. R5 accepts both: synchronous eligible steer and validated response-wide receipts with atomic success settlement. It also accepts explicit conflict waits and receipt-order independence before effects. Cutoff is concretely before Pi poll, captured on initial dispatch/finishTurn and persisted with first PREPARED; this avoids assuming awaited synchronous hooks cannot interleave with other ready agents. Add corresponding microtask/cutoff, reversed order, invalid receipt and replay/atomicity tests. Same product rulings; no new grace/deadline. Raw R4 reply and screenshot retained ignored.

R5 submitted `2026-11-06T10:50:03.972Z` (18:50:03 HKT), same Opus 5.5 Extra session, UI confirmed message 23/24 responding. First read no earlier than 19:00:03 HKT. Complete English request, bilingual snapshots, hash manifest and submission evidence are ignored.

## 2026-11-06 19:00 HKT — R5 PASS

First read `2026-11-06T11:00:22.392Z`, over ten minutes after submission. Same Opus 5.5 Extra session, completed message 24/24: **PASS**, no concrete remaining blocker. Reviewer corrected its R4 assertion about asynchronous interleaving: ready Main Agent continuations can interleave at awaited executor hooks; R5’s before-poll cutoff is independent of that assumption.

Accepted one non-blocking wording clarification before implementation/tests: cutoff establishes required inclusion, but actual persisted-request coverage decides each guidance ID’s gate. A post-cutoff instruction picked up by the poll and included in the same request gets no stale-response grace; success without its disposition fails immediately. This directly follows Master’s clarified ruling. Both languages and race-test requirements now say so; no new product choice or grace policy.

Reviewer source-inspected the baseline and fixed upstream Pi, not local implementation tests. Raw reply `r5-response-ax.txt` and screenshot `r5-result.png` remain ignored. R5 pre-clarification snapshots remain preserved; final hashes separately recorded. Document checks PASS; no product implementation, product test, provider/native acceptance, PR, CI or merge performed. Master’s confirmed WAIT_AUTH, hard rejection and mandatory-consumption choices are settled.
