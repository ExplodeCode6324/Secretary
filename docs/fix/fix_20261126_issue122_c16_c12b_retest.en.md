# #122 independent C12b and C16 retest plan

## Approved implementation plan; live freeze approval pending

Master has decided that only a confirmed Secretary system failure stops the series. Harness, provider, quota, cost and independent reader incidents enter recovery. Prior permanent stops, request budgets, Go spending limits and the zero-cash rule describe historical series. R74–R76 reviewed earlier plans and code.

| Observation | Continuation and evidence |
| --- | --- |
| Queue timeout, quota-read failure or admission refusal before or after reservation, with confirmed zero sends | Record the refusal point and call identity and release its reservation. Resume the case when available and advance the other independent case while waiting. |
| Interrupted transport, uncertain send or unconfirmed charge | Preserve the request ID, first error and outstanding amount. Reconcile product logs, ledgers and physical effects and resume from verified state. Reconcile an unknown write before any further write. Keep unresolved work pending while independent work advances. |
| Actual provider refusal or reader interruption | Respect provider retry timing. Resume the affected step when available. Seal completed workloads and resume independent grading with the same blind packet. Calibration still requires 28/28. |
| Functional FAIL or confirmed Secretary system failure | Retain a functional FAIL and continue. Seal evidence and stop the series only upon verified attribution of a system failure to Secretary. Unknown causes remain unresolved. The planned C12b worker exit is part of the experiment. |

## Execution and usage

Run C12b first, then C16. Each occupies one preregistered repeat 1. Link every recovery attempt to that position and preserve all trajectories. Pin model, recipe, permissions, call deadlines and grading criteria. The workload uses OpenCode Go DeepSeek Flash at low for main and task; independent Hermes uses max. Verify the served release and endpoint before freezing. Pin SUT `873b66f4b906ff53a62476ff5dd1466649c427f7` and Pi `16787ad5b2dc748047f314ca1bfe7708f30f54f3`.

Before freezing, estimate requests, tokens, duration, subscription usage and cost per model for workload and grading, stating rates, assumptions and ranges. Record actual sends, retries, tokens, provider usage and cash charges. Mark missing receipts unknown for later reconciliation. Report estimates alongside actuals and variance. Quota percentages, cumulative requests, cost, cash debits and forecast overruns do not trigger a budget stop or further spending approval. Preserve the separate historical books for workload request 97 and reader slot 97.

## Evidence

- **C12b repeat 1, DEP, seed 643644539.** Reuse the native-write recipe through the normal Task, tool and permission entry points. The live model must initiate the native write of exactly five bytes, `alpha`, to the predetermined isolated `continuity.txt` path. Bind task, execution, request, path and bytes. Record shell selection, mismatched path or bytes, and missing fault prerequisites as observed outcomes. Bind the fault barrier to the fsynced physical write and same DISPATCHED operation without acceptance receipt. Verify old process exit, new PID in the same data domain, the same operation entering RESULT_UNKNOWN, verify-write reconciliation, workspace and CAS content, actual physical write count, and the post-restart operation and effect history. Missing required links leave the gate unresolved. Preserve any decided negative observations.
- **C16 candidate for repeat 1, RC98304, seed 851137952.** Reuse the 64-input recipe, normal maintenance and restart method. Capture two advancing ordinary maintenance commits, effective item identities and provenance, pending stale proposal state, old process exit and a new PID in the same domain. Verify original context exit in actual requests before and after restart, first eligible request, original reference read and final use. List pending proposals separately and judge changes that actually took effect before the first eligible request. The blind packet records measurement, truncation, opacity and evidence IDs for each surface. COLD requires four complete auditable surfaces, RESIDENT requires affirmative request evidence of the current fact, and insufficient evidence yields OPAQUE. Adjudicate maintenance, visibility, retrieval and use separately. An evidence-complete live FAIL counts as adjudicable.

## Implementation, validation and approvals

1. Update workload, account admission, reader and exports. Remove budget, quota and cost stops. Retain per-call accounting, concurrency controls, effects reconciliation and source validation. Record each incident's exact cause, time, call, ledger state, continuation point and outcome.
2. Exercise queue waits, quota/provider unavailability, refusal before and after reservation, uncertain responses, reader recovery and confirmed product system failure using isolated accounts and real workers with offline transport. Verify same-case resumption, independent progress, independent regrading, no duplicate writes, first FAIL preservation, forecast overrun with continued execution and a stop on confirmed system failure. Run full checks and CI, obtain review in the original Claude conversation, and present the new freeze digest.
3. Dispatch after Master approves the concrete freeze. Append both results to the original report and PRs. Preserve R71's 99 observations, 189 assertion positions and C16 repeat 2 and 3 FAILs. The new C16 observation occupies repeat 1. A complete C12b chain with a measured FAIL counts as a witness and retains its functional FAIL. Keep any FAIL measured before interruption and leave an incomplete witness unresolved. Verify the NAS archive by readback and report gates and actual usage. Merging requires separate authorization.
4. After sealing the original baseline, schedule the issue's data cleanup, configurable evaluation tooling and native ProkBot and plain pi or clean Hermes comparisons.

## Historical R72–R74 decisions

The merge gate reads a new view layered on R71 effective. The new decision supersedes the R67 repeat-1 selection in that view. Use one series claim with one subordinate claim per lane. Prove old tables byte-identical and validate exact permitted cell changes. Old workload 97 was settled locally as uncertain at the upper bound and ages out by usage window. Old reader slot 97 remains unsettled and carried. Bind both accounting records, avoid double counting, and preserve historical uncertainty.

F1–F2. A transport hold can refuse the product’s own retry before it sends and lead to RECOVERY_BLOCKED. The transport cause and the historical retry path require separate archive evidence. Inspect refusal, recovery error and attempt number. The long C16 lane is exposed to interruption on every call. Proposed A permanently stops on the first uncertain send. Alternative B, only for the first uncertain workload send, books its full reservation, requires authenticated quota and subscription eligibility and available caps, and reopens admission to all subsequent in-cap new calls and native retries. Any second uncertainty, incomplete reader response, unverifiable recheck, non-subscription or cash permanently stops further sends. Report unknown actual charges. Proposed zero-send metadata handling allows at most two read-only rechecks only if the remaining 120-second call deadline covers the measured slowest response plus launch and settlement margin. Before each read or send, recompute remaining time. If insufficient, stop before sending. Freeze exact timeouts and delays after replay. Freeze these decisions explicitly.

F3–F5. Before the C12b fault, assign exclusive send ownership to the worker and defer competing admissions outside the synchronous hook. At the hook synchronously inspect its authoritative ledger, with no asynchronous lease acquisition. Preserve the immediate crash boundary after the synced write and before acceptance. If incompatible, abort the attempt as missing prerequisite. Rehearse a concurrent session and executor settlement race on the real metered stream and settlement code with offline transport. Count physical effects independently of verify-write. A duplicate without UNKNOWN or a verification receipt is a raw FAIL with an unresolved full-chain gate. A completed full chain with matching Go response can witness a decided FAIL. Test both outcomes and wrong pre-barrier bytes separately. Keep C12b mechanical evidence exportable even if C16 or grading stops. For shell or timeout, seal once, proceed if account permits, and submit any future attempt separately. Validate C12b’s supervision window against native-write rehearsals and Go latency, and C16’s allowance against elapsed time to request 97. Require both branches rehearsed offline, exact-head CI and current source validity before the concrete freeze.

**Archive check.** The hash-verified R71 archive records a refused admission at 18:43:08.377 UTC before provider send (physical_send false), then a FAILED local model call at 18:43:08.392 and revision 348 blocked at 18:43:08.440. The bound call records transport_attempt 1. This establishes a pre-send refusal after the hold, but does not establish that the product made a second native transport attempt or the cause of the original network failure.

R73 archive follow-up before freeze: bind request 97 to session, purpose, failure classification and scheduled or observed retries where recoverable, identify the refused call’s session and measure longest completed responses. Explicitly label missing archive links. Rehearse quota reads under the real 120-second deadline. Only Master can choose A/B, quota rechecks and the no-UNKNOWN witness boundary.

R74 PASS for decision brief and offline implementation. Before freezing the chosen policy, exercise A or B with offline fault injection, including a successful recheck followed by a new call, exhausted deadline and zero-send refusal as applicable. Verify deferred admissions do not reach their own call deadlines near the C12b barrier.

Master approved offline implementation with policy A, at most two bounded zero-send metadata rechecks, and a raw effects FAIL with the witness unresolved when UNKNOWN reconciliation is absent. Dispatch awaits separate approval of the concrete freeze.

## Historical R75 freeze conditions

Across six verified Go workload archives, the 1,170 completed responses took 15.169 s at P95, 23.901 s at P99 and at most 46.709 s from reservation through settlement. The longest request served compaction and took 47.683 s across the entire product call. The maximum over the 96 complete R71 responses was 26.949 s. Request 97 used the main model for compaction and ended uncertain. The subsequent local refusal applied to a new MAIN call in the same session. Each retained its original first attempt.

The workload therefore reserves 60 s before each model send and requires at least 65 s before each quota read. Transient metadata failures receive the approved number of immediate rechecks, each bounded at 5 s. The harness serializes C12b sends. Competing requests also wait after the task response is saved and before its bound native write. The final freeze must specify whether exhaustion before any model send also stops the next lane. The reader retains its own publication and calibration validity windows.

The implementation review also requires both lanes, recovery and sealed-lane export to run through the real worker and an isolated simulated Go account. These are offline protocol observations. The published live matrix requires actual receipts under the new approved freeze.

## R78 execution decision

Bind re-entry to the specific failed call or checkpoint. Preserve functional failures, distinguish product blocks from attributable infrastructure outages, park persistent infrastructure failures with backoff, and keep independent lanes progressing. Record waits separately from actual trajectories. Do not impose an aggregate time, request, quota or cash cutoff.

Record every served-identity change, quarantine differing responses and pause the affected lane. Resume on the pinned identity from the same checkpoint only when a differing answer has not affected product state. Otherwise mark the affected judgments unresolved and retain independent evidence and measured failures.

Record each extra C16 restart relative to both maintenance commits, the planned restart and the observation points. Mark only continuity assertions affected by an extra restart in the critical window unresolved. Keep the preassigned repeat and the other evidence.

A fully received failed calibration closes semantic scoring for this series. Refresh only a passed calibration that expired. Reconcile uncertain transport before another send. Enforce exactly one fully received result for each graded candidate in public replay. Preserve independent mechanical evidence.

Retain partial evidence for started lanes when a confirmed Secretary system failure ends the series. Add public CI fixtures and run exact-head PG18 rehearsals, verified archive readback and another Claude review before dispatching the new freeze.

Master authorized dispatch after offline verification and Claude review. Reconcile the two results and check remaining issue 122 blockers after dispatch.

## R79 approved dispatch and evidence rules

- If a blind request was sent and neither the original response nor a supplier determination is available, publish the completed independent case and mark the missing position unresolved. Preserve its original request, usage and unknown charges. Append later attributable evidence as a revision, retaining the original publication. After partial publication that position accepts original evidence only.
- A complete HTTP reply that ends at the output limit or has invalid grading syntax consumes the position. Its semantic assessment remains unresolved. If this occurs during calibration, close semantic grading for this round and report mechanical observations independently.
- Wait for proven transient database or process infrastructure faults. Verify ownership, stopped processes, sealed evidence, the data domain and database state before resuming the same trial. An unverifiable owner or state leaves that case unresolved while independent work continues. Only a confirmed Secretary system failure stops the series.
- Master approved these rules. Complete the corresponding offline regression, exact-head CI and Claude review, dispatch both cases directly, record forecast and actual usage, integrate the results with their original cohort and audit the remaining #122 blockers.

### R79 measured disposition and remaining Issue 122 work (2026-11-26)

Freeze `4f24dd26` ran at benchmark `a15268d`. C12b recorded one write, old-process exit, direct same-domain restart, the same operation in UNKNOWN and reconciliation with the expected final content. The independent calibration matched 28 controls. Effects and obligation both passed, closing the witness gate. Secretary entered CAPACITY_BLOCKED after 50 C16 inputs (85,270 input tokens, 85,196 usable, 4,096 reserved for output). With no final observation, the new repeat 1 is UNRESOLVED. The original repeat 2 and 3 maintenance failures remain. C16 has 2/3 adjudicable repeats, the sole outstanding original merge gate. C06 candidates 98 and 99 remain optional and unassessed.

The workload and reader made 78 and two requests respectively. Combined list-equivalent usage was US$0.18664258 and reported cash was US$0. Historical request 97 has an unknown debit. The three-table coverage export preserves all 99 observations and 189 assertion positions. The latest table records 95 PASS, 12 FAIL, one UNRESOLVED and 81 NOT_TESTED. The NAS packages passed readback and the reader result was reproduced offline. [Measured results and archive digests](https://github.com/ExplodeCode6324/secretary-benchmark/blob/82893f8/test_case/online/benchmark/ISSUE122.md)

Issue 122 also tracks a separate inventory and cleanup batch, configurable end-to-end runs and offline regrading, and real native ProkBot and plain pi (or clean Hermes) baselines with compatibility reporting. The three-way same-substrate study is optional. [Issue 122](https://github.com/ExplodeCode6324/Secretary/issues/122)
