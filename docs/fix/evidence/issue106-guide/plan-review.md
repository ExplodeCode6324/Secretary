# Issue #106 plan review

**Final: Claude Opus 5.5 Extra R4 PASS — plan readiness only; implementation awaits Master approval.**

- 2026-11-07: Master requested claim, bilingual plan, browser Claude Opus 5.5 Extra review, then explicit implementation approval. The completed implementation must include a running isolated real-model instance, acceptance checklist and concrete commands before Master product acceptance.
- Baseline inspected: `cfc3ca6efd86137956a730a3986dfacfef5bfba4`; #103/#104/#105 closed, #109 records final Master native acceptance. #106 assigned to ExplodeCode6324 and claim/scope comment posted.
- R1 prepared. Product code, tests, model calls and deployment: NOT_RUN. Raw review material belongs in ignored `.demo-data/issue106/review/`.

## R1 in progress

Submitted 2026-11-07 08:36:08 HKT to [dedicated Claude conversation](https://claude.ai/chat/030bfedf-7672-4d56-93cb-aec4f4456d99), with the full English plan and repository/issue URLs; the page explicitly showed Opus 5.5 Extra. First read after ten minutes at 08:46 HKT: still running, inspecting state-directory/launcher seams. The reviewer page reports baseline code execution denied in that session; no independent test execution is claimed. Next observation no earlier than five minutes later.

Local planning validation: `npm run docs:check` PASS (709 Markdown files, 9,013 links; 122 localized sources / 366 pages / 726 units current). Product tests/provider calls/implementation remain NOT_RUN. GitHub connector independently verified remote main equals the inspected SHA; CLI `git ls-remote` failed with HTTP2 framing error.

## R1 result and R2 disposition

R1 observed after the next five-minute interval, 2026-11-07 08:51 HKT: **CHANGES_REQUIRED**, four blockers. Reviewer inspected exact baseline source and pinned Pi; independently executed product tests: **NOT_RUN** (session policy denial), provider calls: none.

| Finding | Codex disposition |
| --- | --- |
| B1 unresolved singleton could block all future guide sends | Accepted. Added same-envelope replay-first irreversible rejection proofs, ordered terminal/RESULT_UNKNOWN→request-NOT_FOUND query-only proof, retained uncertainty for cancelling/transports, explicit durable conflict export/release. Generic contract-drift INVALID_REQUEST and uncertain TARGET_NOT_FOUND deliberately remain excluded. |
| B2 duplicate historical SENT text and new receipt rows | Accepted. Retain chronological admission message; separate compact receipt section outside message paging; full text appears in an explicit alternate detail view. |
| B3 exact-text overclaim at input ingestion | Accepted. Fidelity starts at the expanded stored editor draft; existing CR/control normalization and physical Tab behavior documented. Added NFD/ZWJ/Unicode whitespace and multiline completion suffix checks. |
| B4 runtime/credential/isolation/budget mechanism underspecified | Accepted. Reuse issue94 in-process App/serveCore and metered real streams, product TerminalApp via HTTP/SSE; checked issue103-style .env.local loader, one existing DeepSeek key attributed by role, explicit World DB, clean SECRETARY_* environment, detached persistent process and identity-checked stop. |

Also incorporated separate guidanceRecovery and v4 collection protection, ACCEPTED_VERIFICATION_PENDING read failures, header-only debounced preview, existing-row pagination refresh, Task undo preservation, explicit aggregate ledger and wall-clock windows/reserves, and exact injected stateRoot/live mode. Local source verification confirms Authorization.prepare creates pending authorization with expires_at=null: the prepared manual scenario uses a genuine WAIT_AUTH, not an ordinary question Main may answer. This is a sourced clarification of the suggested hold mechanism.

R2 supplies the complete revised English plan and all dispositions to the same Claude conversation. Product implementation remains unauthorized and NOT_STARTED; no model calls or instance setup occurred.

## R2 result and R3 disposition

R2 observed after ten minutes on 2026-11-07 09:04:50 HKT: **CHANGES_REQUIRED (one small blocker)**. All four R1 blockers explicitly resolved. Reviewer checked baseline facts; no tests or provider calls. Remaining blocker accepted: start the two-hour manual window at Master's first explicit connect, not preparation. Preparation/rehearsal remains charged to the automated window/shared counters; an armed, query-serving, pump-gated phase prevents delayed arrival from consuming the scenario through budget-refusal failures. Publish not-started versus absolute HKT deadline and pre-connect readiness checks.

Nonblocking precisions accepted in R3: DIRECTORY/default_write=ask and remembered-rule checks; fresh World migration and readiness plus owned PostgreSQL start; explicit serveCore shutdown callback; absolute checked credential path; remove legacy-dependent TARGET_MISMATCH/UNSUPPORTED_EXECUTOR from irreversible proofs; durably quarantine accepted integrity errors outside the unresolved slot with a no-resend binding; F6 enters guidance focus without Tab collision; place receipt metadata before each message group and test follow-tail preservation.

R3 resubmits the full bilingual-synchronized English plan. Still plan-only; no product changes/provider calls.

## R3 result and R4 disposition

R3 observed after ten minutes at 2026-11-07 09:17 HKT: **CHANGES_REQUIRED (one narrow blocker)**. It explicitly resolved the R2 handoff clock and all eight notes; verified pump:false, App.pump, recovery and F6 source. No tests/provider calls. Remaining blocker accepted: persist ACTIVE, automatically restore its pump on Core restart, and do not apply first-handoff reserves on ordinary reconnect. R4 defines ARMED_FOR_MASTER / ACTIVE / EXHAUSTED, separates process status, and adds automatic TUI reconnection plus below-reserve-but-unexhausted regression tests.

Also accepted: Mac Fn+F6 hint/native test, report/refuse unexpected provider entries from long-route bypasses while armed, stop/await the harness-owned pump at shutdown, and separate rehearsal state from Master's clean initial state root. No product change or provider call occurred. R4 sends the full revised English plan to the same conversation.

## R4 final PASS

Observed 2026-11-07 09:29 HKT, after the required ten-minute initial wait from 09:19:03: **PASS (plan readiness)**. Same [Claude conversation](https://claude.ai/chat/030bfedf-7672-4d56-93cb-aec4f4456d99). Reviewer found no remaining blocker and explicitly resolved the R3 reconnect lifecycle and all four notes. It inspected the unchanged baseline and pinned Pi F6 mapping; it did not run tests or call providers. Its references to new tests describe the planned tests, not executed evidence.

Two nonblocking precisions accepted in both plans: wall-clock budget includes Mac sleep/lid-closed time, and phase/deadline/counters/extensions share one atomic fsynced ledger write. These clarify the already reviewed wall-clock and durable-phase contract.

Implementation review must check actual delivery proof tests, nonduplicated receipt display, expanded-draft fidelity, and acceptance lifecycle/metering/isolated TUI roots against exact PR HEAD and CI. Native F6/IME/clipboard, real-provider behavior and Master's product acceptance remain future evidence, NOT_RUN. No product code/schema/test/CI change, provider call or acceptance deployment occurred in this planning task. Master must explicitly approve implementation; merge/closure and product acceptance remain separate.
