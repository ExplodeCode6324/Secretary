# Issue #2 pre-implementation acceptance baseline

This document describes the frozen 13-case `context-memory.test.ts` baseline only. Additional implementation suites now live beside it; their measured results, broader C01–C20 coverage and remaining gaps are recorded in [the implementation report](../../reports/memory-review-20261008/README.md). The frozen baseline assertions and original results are retained.

This dedicated suite contains established safety invariants (`INV-*`) and observable desired behaviors (`GOAL-*`) from the issue #2 plan. It is intentionally outside `npm test`: desired behavior failures on unchanged code remain actual failures, never skips, TODOs, or expected-failure passes. No business implementation has been added by this suite.

From the repository root, use the same runner before and after changes, choosing a new output directory to preserve the original baseline (the runner refuses an existing results directory):

```sh
node test_case/offline/issue2/run-baseline.mjs test_case/reports/issue2-context-memory-after
```

The runner removes inherited `SECRETARY_*` overrides, injects only synthetic Model/StreamFn implementations, creates fresh OS temporary storage per test, explicitly typechecks the suite (the root tsconfig excludes this directory), and saves TAP, stderr, test classification, first failure diagnostics, source/suite SHA-256 hashes, HEAD and submodule HEAD. Test timeout is 15 seconds; the summary-start gate has its own 5-second timeout and unconditional release; the subprocess ceiling is 180 seconds. The fixture cleans up its synthetic temporary storage. A nonzero exit means a real typecheck/test/harness failure. There are no provider credentials, database configuration, production directories, private conversations, real network requests, or paid model calls.

`App`, public Host methods, `durableStream`, and `saveContext` are the current Secretary-facing test entry points. The tests do not assert a Pi `prepareRequest` hook or require its original main loop. Direct transport inputs use the installed public `normalizeContext()` API: tool declarations actually reside in system transcript messages. If Secretary later replaces these entry points, adapt the small harness seam without changing the observable acceptance assertions; retain old and new harness hashes and document the migration.

| Test | Plan coverage | Observable assertion |
| --- | --- | --- |
| INV-01 | C06, partial | Complete provider response exists in durable store before stream consumer receives tool response. This does not prove kill/restart behavior. |
| INV-02 | C06, partial | Huge main input causes zero provider calls, visible capacity block, original accepted payload retained. |
| INV-03 | C08, partial | Failed summary has two attempts, no memory commit, immutable source; same failed source above old 32KiB threshold does not restart automatically. |
| INV-04 | C08, partial | Both summary attempts respect a 4096 model output ceiling. |
| INV-05 | C05, partial | Normalized request snapshot preserves actual tool declaration. |
| INV-06 | C05, partial | Huge normalized tool declaration triggers capacity block before provider call. |
| GOAL-01 | C03 | One fresh ordinary 36KiB input on synthetic 1M context does not trigger legacy byte-based maintenance. |
| GOAL-02 | C04/C15, partial | Eight completed ordinary low-occupancy turns cause one memory update and preserve all eight assistant messages in next-request preview. |
| GOAL-03 | C08, partial | Invalid first JSON causes default 16384 then 32768 summary output requests when model capacity permits. |
| GOAL-04 | C02/C05, partial | Requested output consumes the entire context: either expose capacity block with zero sends, or explicitly resolve output below the context less the default minimum 2048 safety margin, leaving nonempty input room. This is a minimum bound, not complete token accounting or real adapter coverage. |
| GOAL-07 | C06, partial | Oversized recovery checkpoint can be saved and retrieved without granting permission to send. |
| GOAL-08 | C09, partial | A new ACCEPTED input does not invalidate frozen completed older memory sources; new input remains queued. |
| GOAL-09 | C18, partial | Extraction failure after successful summary must not invoke either model again through an outer summary retry; no memory commit. |

IDs GOAL-05/06 were reclassified as INV-05/06 after the real normalized interface proved that current tool accounting already includes system transcript declarations. The baseline therefore corrects the earlier static assumption that tools were entirely omitted. It does not establish accurate token counting, effective tool replay accounting, or provider wire-envelope accounting.

## Explicitly unimplemented coverage

This is a focused executable baseline, not complete C01–C20 acceptance. C01 deployment/input/output config validation, C02 exact threshold-token boundaries, C04 timed 60s/120s scheduling and critical events, C05 tokenizer/cache calibration and model switching, C06 giant tool results/task recovery, C07 compression target/uncompressible constraints, C08 aggregate output limits/reasoning, C09 conflict/restart/mutual exclusion, C10 migration/settings, C11 browser/TUI, C12 live replay cost/quality, C13 1K/10K/100K scaling, C14 real adapter plus local HTTP capture, C15 repeated identical events/covered-history reuse/settings rebuild, C16 in-loop compaction and kill windows, C17 segmentation/source coverage, C18 persisted stage recovery/failure-prefix dedupe, C19 external settings receipt recovery, and C20 fairness remain unimplemented here. No placeholder tests claim these pass.

GOAL-02 fails first on the absent update in the old implementation; its later history-preservation assertion is present but was not reached on that baseline. Direct response durability is not end-to-end tool execution, side-effect recovery, deployment, live-provider, or semantic model-quality evidence. Timing in TAP is diagnostic, not a controlled performance benchmark. The current plan's batch-size/timing values are provisional; any approved policy change requires an explicit acceptance update, never silent weakening to match old behavior.

The saved baseline and existing-suite results are in the local-only, unpublished baseline report (`../../reports/issue2-context-memory-baseline/README.md`).
