# Issue #93 plan review

Base: `843836ef156ee0cd0dda3549cbf9c8ced2458e6a`. Scope: plan only; Master must explicitly approve implementation.

Reviewer: existing browser Claude, verified Opus 5.5 Extra. Same conversation: https://claude.ai/chat/a204554f-66a6-4dee-8c08-ef36307dee52 . Raw requests/replies/screenshots: ignored `.demo-data/issue93/review/`.

## R1 — CHANGES_REQUIRED

Sent 2026-11-02 23:23:48 HKT; first check after ten minutes found running; next check after five minutes obtained final reply. Claude reports cloning/checking out the exact source base and reading owning code/documents. Issue text was available only through a paraphrasing fetcher; it did not independently verify live issue states, latest #92 comment/CI or Chinese parity. No tests, Core, provider or terminal execution by reviewer.

All six blockers accepted:

| Finding | Codex disposition |
| --- | --- |
| B1 REDO could weaken requirements | Pin complete effective parent requirements/materials in Core; reject explicit differences; verify digest at completion |
| B2 live scenario feasibility | Environmental input repair without task edits; independent artifact verification; stable WAIT/controlled running cancellation; per-scenario budget and explicit budget-extension approval |
| B3 autonomous follow-ups | Propose approval of narrow failed/Master-cancelled feedback-only task_propose guard; record all live tool attempts |
| B4 identity dead end/two keys | Shared EXECUTION:id key, evidence attributes separate; missing result doesn't block dismissal; shared init episode projection |
| B5 concurrency/revision | Explicit state × intent table, record-only revision, pending conflicts, resolved admission rejection and direct-parent limit |
| B6 recovery/authority/errors | Durable stable tool receipts for dismissal/link/error; Core-level guards; recoverTools extension; derived NO_ACTION |

Non-blocking notes adopted: align activity.ts failure membership; truthful INIT_FAILED reminder wording/disabled REDO; ID-only canonical intent; claimed-Input authority; FAILED + UNKNOWN independence test; observed cancellation outcome without causal command claim; one FailureHandling record plus events. Corrected Delivery draft-clearing timing to local-outbox save before acceptance.

Master approval implications: historical failures may increase current Task counts and each dismissal uses Main model work; direct-link-only resolution leaves an earlier failed ancestor pending after a later descendant succeeds; feedback-only automatic recovery is tightened. These are explicitly included in both plan versions, not implemented.

## R2 — CHANGES_REQUIRED

Full revised English plan and Chinese counterpart were provided in the same conversation. Implementation, real-provider/native gates and exact-head CI remain NOT_TESTED; merge not authorized.

R2 received after the ten-minute first wait. Verdict CHANGES_REQUIRED: B1–B6 substantively closed; English/Chinese substantive parity confirmed. Four wording/contract issues accepted for R3:

- R2-1: REDO-only schema makes goal optional, Core fills canonical parent fields; ordinary proposals still require goal.
- R2-2: guard uses FAILED/CANCELLED outcome regardless of cancellation origin; EXPIRED explicitly retains existing behavior.
- R2-3: each FAILED/CANCELLED RESULT feedback gets an isolated ordered Main batch, avoiding unrelated success or Master-message mixing. Added model-call cost to approval consequences and reserved feedback calls within the existing hard live budget.
- R2-4: execution-failure REDO remains submittable with predicted continuation blockers so Main can return real errors; only INIT_FAILED/409 states disable it.

Non-blocking notes adopted: first durable terminal fact by journal sequence decides dismissal/success order; pinned expired deadlines may lead to actual EXPIRED and need honest prediction; English draft sentence corrected. R3 pending. Reviewer re-read relevant source from its prior exact-base checkout; no fresh fetch or runtime/test/provider/native execution claimed.


## R3 — PASS (plan only)

Sent 2026-11-02 23:59:42 HKT; read after the ten-minute first wait on 2026-11-03. Claude read the entire third request, including both languages (327 lines), and confirmed all R2 findings/non-blocking notes closed, no new blocker, internal consistency and substantive bilingual parity. It relied on its previous exact-base source inspection; it did not execute tests, Core, providers or native Terminal, and did not independently fetch current main/issue/CI status.

Final non-blocking implementation notes adopted: use Feedback.result_id/TaskResult outcome for batch isolation, conservatively isolate unreadable results, and rebuild the same context-specific tool schema during recovery. Explicit limitation retained for Master: EXPIRED feedback is outside the new FAILED/CANCELLED guard and may still prompt baseline autonomous follow-up; live gates must detect and reject such unrequested recovery. These clarifications are recorded in both languages.

Verdict: **PASS_PLAN_ONLY**. Master implementation approval is NOT_GRANTED. Real-provider gates L1–L4, physical acceptance, implementation exact-head CI, same-session implementation review and separate merge authorization remain outstanding.

Plan validation: npm run docs:check passes (655 Markdown files; 8,488 local links; 117 sources / 351 localized pages current); git diff --cached --check passes; contract-marker/section checks found both plans aligned. Only the two plans and two evidence ledgers are changed; no product code, dependency, test or CI changes. Raw review response and screenshot: ignored `.demo-data/issue93/review/r3-response.txt` and `r3-pass.png`.
