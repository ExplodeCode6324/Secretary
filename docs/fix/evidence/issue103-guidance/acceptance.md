# Issue #103 implementation evidence

Master approved implementation after Claude R5 PASS and the final product rulings. This record separates Core fixtures, the actual provider, CI, source review and native acceptance. Baseline: `f22e85f01e2f8704c0b2e61ee5fb8504a5e6d7c2`. No merge is authorized by this record.

## Delivered behavior

- Exact execution-scoped Master API and proven Main `task_control` ingress share durable admission. Master informational Input and ApiCommand commit with Guidance; caps refuse sends without truncation or business records. Idempotent reconciliation survives target termination.
- Host injection/checkpoint provenance proves RECEIVED. Actual immutable ModelCall input and structured response receipts prove GUIDED. Full-response receipt validation handles `submit_result` or effects before the receipt tool in the same response.
- The next eligible fresh request must contain accepted guidance. An old response waits for a new turn; included instructions with no valid disposition at attempted success immediately fail. No three-response tolerance exists. A blocked request retains unsent request evidence.
- Pending authorization remains pending. Approved obsolete operations that never started retire with host evidence, then replan under ordinary authorization. Denial still fails. The resume loop checks each operation; the shell launcher has a separate proven-not-started barrier. Started or unknown effects retain the existing safety rules.
- Master-only conflict decisions cannot be answered by Main. Failure/cancellation/expiry retain the original cause and settle outstanding guidance; normal milestones create no extra Main progress input. Execution indices bound guidance reads independently of unrelated history.

## Offline evidence

`test_case/offline/issue103/guidance.test.ts` exercises atomic acceptance, immutable original bytes and origins, count/byte rejection without writes, replay identities, reversed receipt order, immediate missing-disposition failure, old in-flight response ordering, necessary reads, conflicts/answers, WAIT_AUTH approve/reject, Main tool provenance, frozen PREPARED/IN_FLIGHT/RESPONSE_SAVED recovery, process-local queue loss/checkpoint recovery, the pre-poll microtask race, per-tool and per-effect barriers, Main recovery isolation, call limits, missing/forged/contradictory receipts, cancellation, multiple instructions, two approved writes, and same-argument replacement authorization.

First failures are retained in ignored `.demo-data/issue103/`: initial contract/type integration errors were fixed at their source; `verify-first.log` found missing translation units (added English/Japanese/French units, with no check suppression); `targeted-07.log` found two write fixtures using the default automatically allowed workspace. Both fixtures now use the existing explicit-approval scope helper, preserving the assertions; `writes-02.log` passed 2/2. The strengthened restart fixtures initially omitted the required Agent streamFn; the restored queue seed now explicitly forbids provider calls. The full-suite DTO comparison caught command ordering drift between the operation source and router; the operation source was aligned and generated artifacts rebuilt, with assertions unchanged. `recovery-dto-02.log` then passed all four recovery/DTO checks. Subsequent validation results are attached to the exact PR head rather than rewriting historical logs.

Targeted suite before the restart strengthening: 29/29 PASS (`targeted-08.log`); restart/DTO follow-up: 4/4 PASS. Type check, changed-file formatting and documentation checks pass. Repository-wide formatting additionally reports a pre-existing `core-client.ts` issue outside this diff; it is not a required verify step and was not reformatted here.

Full `npm run verify` is also run with a newly created isolated PostgreSQL instance and per-scenario databases. The ordinary run without its test DSN explicitly skips database cases and is not database acceptance. Linux/macOS CI and final counts must be checked against the PR head.

## Controlled real DeepSeek acceptance

`test_case/online/issue103-guidance.ts` uses an isolated data directory, the existing private DeepSeek credential, real `deepseek-flash` responses, a six-physical-request limit and twenty-tool limit. No response or receipt is scripted. Main is intentionally unavailable and RECOVERY_BLOCKED throughout.

Observed PASS: 5 physical requests, 6 tools, 0 Main requests. The first request was already sent when Master guidance restricted the permitted source to `first.txt`, prohibited writes and required `GUIDANCE_LIVE_103` in the final summary. That frozen first request contained no new instruction. Later actual requests included it; the provider produced ADOPTED evidence and a successful factual result carrying the marker. Successful reads did not return the excluded second source; both source files remained byte-identical. SENT, RECEIVED and GUIDED remained separate facts.

Raw requests are identified by hash; durable contexts/responses, tool results and receipt evidence remain in ignored local storage. The initial harness attempt (`live-first.log`) stopped before any provider call because the optional legacy task-key file did not exist; the harness then used the existing permission-checked `.env.local`. The first actual provider run (`live-02.log`) passed. No credentials or private paths are included in this evidence document.

## Limits and subsequent issues

GUIDED is an attributable model adoption claim, not proof of every semantic consequence. The live case tests one concrete restriction; fixtures establish additional host invariants. Native Terminal/IME/clipboard and the future `/guide` workflow are NOT_TESTED here. Existing authorization/question labels were updated, but no browser page substitutes for terminal acceptance. Master product acceptance remains separate.

#104 can consume bounded transient Task previews without turning preview into receipt evidence. #105 adds stable titles and immutable execution_round resolution. #106 will freeze the resolved exact IDs, submit through this API and reconcile the original request identity; its draft/outbox and native command acceptance remain its own scope. No #104–#106 feature is implemented in this change. API inventory is 96 operations; TUI still consumes 31, with all three guidance endpoints explicitly unused pending #106.

Implementation review uses the same Claude Opus 5.5 Extra conversation as the plan. Final head, CI and review disposition will be recorded on the PR after code freeze. Master must separately approve merge.
