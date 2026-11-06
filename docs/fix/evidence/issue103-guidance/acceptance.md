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

## R6 findings and corrections

Claude inspected `fb6b6ea6`, independently ran the 29 guidance tests and supplied two executable reproductions. Verdict: CHANGES_REQUIRED. Both blockers were accepted: replay of an already-applied tool must return its durable result before checking new guidance, and retiring some obsolete operation must not defer a different current operation. The wrapper now returns recorded tool results first; each effect checks retirement of its own operation, resume loops skip retired operations, and a launcher-window stop retires the remaining obsolete operations. New tests reproduce the applied-write/restart history and the two-shell launcher followed by a newly adopted write.

Also accepted: unregister runtime Agents on run exit; do not make unrelated ordinary questions Master-only merely because Master guidance exists; if a conflict answer lacks a subsequent resolving receipt, create one deduplicated explicit wait for the new answer epoch. The shared receipt validator still requires a Master source/answer to resolve a Master restriction.

Full regression testing exposed two further compatibility gaps, corrected without changing assertions or capacity limits. First, adding guidance metadata to every result detail broke the existing exact failure-cause classification. Guidance summaries now use an additional TaskResult evidence reference, preserving the original primary detail. The failure projection and prior guidance tests then passed 36/36. Second, the extended Main tool description increased mandatory request content to 16,400 against a 16,220.1 compaction target in the existing 200-round test; a baseline worktree passed while the expanded description failed. Concise tool wording retains all authority/identity semantics with less request overhead; the original test then passed unchanged. The guidance arguments were also moved from the mistakenly extended task_propose schema to task_control, with a test checking the actual model-visible declarations.

Superseded local full-suite runs were interrupted after preserving their first failures. They are not passing evidence. The final commit receives a new complete isolated PostgreSQL run and immutable Linux/macOS CI. The historical R6 review does not cover the corrected head until the same reviewer reviews it again.

R7 local follow-up: 40/40 PASS (33 guidance cases plus 7 existing failure-projection cases), including both R6 reproductions with corrected assertions, released runtimes, conflict re-wait and ordinary question authority. The unchanged 200-round PostgreSQL test passed. A second isolated real DeepSeek acceptance passed on the corrected source with 4 physical calls, 4 tools and zero Main calls (`live-r7.log`); the same exact-source, no-write, original-request and adoption checks remain in force. Type/docs checks pass. Full-suite and hosted CI results remain pending until recorded for the final head.
