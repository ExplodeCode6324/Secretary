# Issue #91 implementation evidence — awaiting final review and Master acceptance

2026-10-30. Branch `codex/issue91-main-history-plan`, implementation based on planning commit `7720389cb79476fea7a1ed5d4e7eda02941008bc`. The approved B rule is implemented: TAB-free/LF-free single-line pastes of <=30 grapheme clusters stay inline; longer, multiline or TAB-containing pastes become owned blocks. The earlier arbitrary-fragment prototype was rejected in R4 and has been replaced under Master-approved §13. Final HEAD, CI and Claude disposition are recorded on the implementation PR; Master acceptance is separate.

## Independent verification

- Full `npm run verify`: **783/783 PASS**, no skips, with an isolated Unix-socket-only PostgreSQL cluster and dedicated test role. This predates the final reader-relocation/mouse corrections.
- After those corrections: typecheck passed; **58/58** issue #82/#91 focused tests passed, plus **1/1** new Core-restart/TerminalApp integration test. These are not a second full-suite run.
- Real Core long-CJK preview supersession, settled body and CoT: PASS. Fixed a client bug where percent-encoding the `message:` colon changed Core's literal body-cursor scope. This is fixture content through real Core, not a live oversized model reply.
- Reader relocation: staging fresh neighbouring pages before publishing prevents a short single anchor from clamping the viewport to the page title. The new restart test preserves the surviving body block/row and draft cursor. This also fixed a real-provider CoT read check.
- Editor: owned-span atomic keys, word deletion, rich undo/kill/yank, typed/pasted/unknown slash classification, exact 30-grapheme boundary, migration/recovery and mouse/restore snapping covered. Damaged snapshots retain orphaned paste payloads for recovery.
- Large-draft diagnostics: synthetic Main and Task each 1/16 MiB, no oversized POST. In the 16+16 MiB case, synchronous state capture fell from 162 ms to about 0.02 ms; asynchronous save took about 272 ms and concurrent edit about 0.12 ms. 16 MiB paste-to-render was 35–38 ms. Chunked JSON encoding round-trips escaped surrogate boundaries and detaches mutable metadata before asynchronous writes. No new quota.
- Rollback helper: `npx tsx src/pi_secretary/scripts/tui-export-v1.ts <state-directory> <new-output-file>` exports current content and immutable pending body while holding the state lock. It never overwrites an existing export/current state. CLI export smoke passed against the stopped isolated TUI state; a rollback itself is not performed.

## Real provider run

Isolated Core without World/PostgreSQL (`core.mode=fixture`), but **actual** configured `opencode-go/deepseek-v4.1-flash` traffic and streaming; no fixture stream substitutes for model output. Start 11:50:25.816 UTC, stopped 12:04:04.094 UTC. **5 physical provider HTTP requests**, all HTTP 200, within the <=12 / 15-minute / 90-second / 4096-token ceilings. Five Master inputs; six message POSTs because L4 explicitly replays one ID.

| Row | Observed result and limit |
| --- | --- |
| L1 | PASS through actual ProcessTerminal/POSIX PTY. Two bracketed pastes plus separately typed A/B expand identically in Core and the provider user message. Deterministic JSON oracle passed. Physical macOS clipboard is NOT_TESTED. |
| L2 middle | PASS through PTY: real streamed revisions preserve the same message, region, block and row. |
| L2 bottom | Initial-bottom observations during L1 PASS through PTY. The separately named bottom attempt was mispositioned by the test operator and is NOT_ACCEPTED as independent coverage. |
| L2 Task-away/return | NOT_ACCEPTED. A pre-fix reconnect had collapsed the reader to the title, so this attempt did not establish a valid message anchor. No additional paid retry was made beyond the five planned inputs. The subsequent correction has fixture restart and real-CoT evidence, not a completed real-stream away/return rerun. |
| L3 | PASS through PTY after the relocation correction: actual reply/body and provider-exposed CoT match Core; both command spellings toggle; same body source block/row survives expand/collapse. Gray ANSI was observed. Provider attempts, message POST count and authoritative sync cursor remain unchanged across the quiet read-only sequence. |
| L4 | PASS, explicitly script-driven TerminalApp + Pi VirtualTerminal/StdinBuffer + real Core/provider. Drop first accepted receipt; block status transport through retry precheck; wait for model quiescence; explicit second identical-ID POST reaches Core. Exactly one matching Input, two same-ID POSTs, provider attempts **5 -> 5**. |

The computer-control tool rejected `com.apple.Terminal` with a safety restriction. No alternate UI mechanism bypassed it. Actual GUI clipboard, physical shortcut, font/IME and larger native-window acceptance remain NOT_TESTED. PTY is 80x24. macOS 15.8.2 / Node v22.22.0 / ICU 78.2.

Harness setup failures were preserved: initial history fixtures lacked a commit (zero model attempts); a diagnostic collector initially parsed a text object as JSON and stopped before any model call (zero attempts). A secondary model invocation hit `CAPACITY_OUTPUT_LIMIT_CHANGED_BY_ADAPTER` before HTTP because the wrapper overrode a smaller requested cap; changed to `min(requested,4096)` and resumed the same ledger/budget. This failed invocation is not counted as a successful model call. Provider bytes, headers and keys are not committed.

Raw evidence: ignored `.demo-data/issue91/implementation/` and `.demo-data/issue91/live-20261030-c/`; key results `l1-result.json`, `l2-result.json`, `l3-result.json`, `replay-result.json`, `provider-ledger.json`, `pty-first-snapshots.json`, `native-snapshots.json`. First failure logs remain alongside corrected runs.

## Claude R4: blocking design finding

Same browser Claude Opus 5.5 Extra session. R4 submitted 11:45:01 UTC, first read after the mandatory ten-minute wait. **CHANGES_REQUIRED**: arbitrary fragment windows cannot preserve supported Markdown. Reviewer reports standalone pinned-Pi probes for tables, ordered/nested lists, emphasis, reference overflow, quoted fences, setext and grapheme cuts; these are reviewer-reported probes, not repository/native/provider execution.

Codex accepts the finding. Bilingual plan §13 proposes complete-block windows and a clearly labelled exceptional formatting boundary for oversized non-code blocks/reference overflow. Master explicitly approved this change on 2026-10-30. The replacement and its evidence are described below. The source-boundary indexing proposal must pass parity properties before being trusted; the review's suggested streaming-lexer rule is not assumed proven merely because it was recommended.

R4 also accepted owned cursor-boundary snapping in place of regex segmentation; its mouse/restore/nearest-boundary concerns were addressed and tested. This is an intermediate feasibility review, not final exact-HEAD approval. No implementation PR, CI result, Master acceptance or merge authorization exists yet.

At checkpoint, typecheck and documentation/localization checks passed. The isolated real-provider Core, both PTY clients and dedicated PostgreSQL cluster were stopped; raw evidence and test-cluster data were preserved.


## Approved §13 implementation

`markdown-lexer.ts` copies the pinned Pi 0.87.0 strict strike/LaTeX configuration with MIT provenance. `markdown-window.ts` retains incomplete physical lines and unstable final blocks, including pending math openers, then emits complete top-level blocks. Exhaustive split-point tests and tiny-fragment render comparisons cover tables, ordered/loose/nested lists, quoted fences, setext, references, math, terminal sanitization, TAB, CJK and ZWJ emoji. The <=1 MiB whole-message render remains Pi's complete renderer. Block mapping now uses the same configured lexer.

Whole-block windows target ~40,000 UTF-16 units and permit <=1 MiB original source per body/CoT region. Fenced and indented oversized code use line windows with synthetic borders removed from continuation output. A single non-code block over budget receives a visible formatting-context-boundary notice, and concatenating windows recovers the original source. Because a loose list/math/quote may continue after a blank line, exceptional context conservatively remains labelled through the remaining region; reference completeness is also marked unavailable rather than silently asserted. A single physical code line or grapheme larger than the byte cap must use the explicit exceptional path; it preserves source bytes/code points, not impossible unbounded grapheme-format equivalence.

Reference definitions use first-definition-wins, up to 256 KiB per region. Overflow never throws; all windows show the notice. The initial walk reaches EOF to collect later definitions, then retains <=32 LRU source/checkpoint entries per region. Checkpoint fence contexts >4096 bytes are not cached; reconstruction may require a longer walk. Resident accounting includes source, selected prefix/suffix, definitions and checkpoint prefixes under the shared 4 MiB budget. A cursor-expiry retry discards the old checkpoint index and reconstructs from a fresh first fragment. No raw history store or new endpoint was added.

Tests caught and corrected an extra synthetic blank code line and a checkpoint eviction policy that discarded newly revisited early positions. Seven Markdown-specific tests and four body/view tests passed at the final local source revision; the complete #82/#91 group previously passed 63/63 before the additional indented-code/notice cases. The subsequent full `npm run verify` run passed **792/792**, no skips (870,482 ms test time). Final harness type fixes and documentation regeneration were checked separately; final focused checks and exact HEAD are recorded on the PR. Failed diagnostic logs remain in the ignored evidence directory.

### Actual Core measurements, synthetic content

| Original UTF-8 bytes | Initial walk | Fragment requests | Retained source/context | Checkpoints | Subsequent three forward seeks |
| --- | --- | --- | --- | --- | --- |
| 2,097,200 | 9,912 ms | 396 | 40,019 bytes | 32 | 386–398 ms; 15–17 requests |
| 4,194,330 | 25,475 ms | 792 | 40,019 bytes | 32 | 487–510 ms; 15–17 requests |

Same-process V8 heap deltas were ~21/81 MB without forced GC; those include Core parsing, temporary lexer/render objects and garbage. They are not the 4 MiB resident-source budget or a heap guarantee. Core currently re-reads the message for each fragment, so the initial traversal has quadratic server-side work. The client yields during initial assembly parsing and displays the existing read-in-progress state. These measurements are not provider-generated oversized replies. Harness: `test_case/online/issue91-body-benchmark.ts`; raw `implementation/body-benchmark.json`.

## Fresh real-provider follow-up after §13

Run `live-20261030-d`, separate from the earlier completed run: 13:01:38.507–13:11:14.183 UTC, same <=12 HTTP / 15-minute ceiling. **5 physical HTTP requests, all 200; 6 model invocations; 5 submitted inputs.** One auxiliary invocation was stopped by `CAPACITY_OUTPUT_LIMIT_CHANGED_BY_ADAPTER` before HTTP; it is not counted as successful provider traffic. The first discarded setup response hit the 4096-token output limit. The two final acceptance replies completed normally.

The first script failed before the ledger file existed. A second reused identical input text and observed an old handled input, so its bottom claim was rejected; the live-event timestamp also needed to be persisted immediately. A third startup check reached the end before asynchronous body hydration finished and correctly failed its at-end precondition, with no extra model call. Scripts now use unique per-run input, wait for the actual input to be handled, persist first stream events, and establish the loaded viewport before capture. All original failed results are retained. The server was resumed with its existing ledger/time budget, not reset to evade the cap.

Final `navigation-result.json`: **PASS**, using actual Core and configured `opencode-go/deepseek-v4.1-flash`, driven by TerminalApp + Pi VirtualTerminal/StdinBuffer (100×30):

- Manual-bottom anchor stayed at the same actual assistant/body/block/row while the new real reply arrived; it ceased being atEnd as expected.
- A real provider call was actively streaming when `/T` left Main. The middle body anchor survived the full Task interval and `/M` return exactly.
- Short inline and long folded pastes expanded exactly into Core input and a real provider user-message request.
- `/CoTv` and `/cotvisible` retained the same real assistant body block/row. Positive provider-exposed CoT was present. The authoritative sync cursor, HTTP-attempt count and POST count stayed unchanged across the quiet read-only toggle sequence.

This closes the scripted-live bottom and Task-away gaps; it does not turn VirtualTerminal into physical clipboard, GUI, font or IME evidence. Earlier ProcessTerminal/POSIX PTY and L4 same-ID replay results remain separately labelled. The live Core was stopped, with private evidence retained.


## R5 findings and R6 corrections

Claude reviewed exact HEAD `4d7ad6f29696b08d39fc5a29d70ee3d3b220235e` in the same Opus 5.5 Extra conversation, independently installed the pinned tree, passed typecheck and 65/65 #82/#91 tests, and returned **CHANGES_REQUIRED**. Raw response: private `review/r5-response-read4.md`. It did not rerun full verification, docs, live-provider or macOS checks.

1. **Visible-body reload loop fixed.** Remote and metadata budgets prioritize visible IDs, then evict farthest from the anchor. The approved shared 4 MiB ceiling remains hard: when visible content alone exceeds it, non-anchor victims become stable rehydratable placeholders; they are not automatically reloaded until anchor/mode/generation changes (explicit navigation still retries). This deliberately differs from the reviewer's suggested soft overage. Regressions reproduce ten 512 KiB bodies, visible m1–m3, zero repeated-layout reads; an all-visible over-budget case stays bounded and recovers after moving the anchor.
2. **Pending math fixed.** Closers must satisfy Pi's exact trailing-space/newline rule. Dollar and bracket counterexamples, with and without a later proper closer, are included in every-split source/block parity tests.
3. **Reference-context retention fixed (independently found).** Previously each source-block probe retained a Markdown object containing a full copy of all reference definitions. A 123,470-byte message with 900 definitions and 2,000 paragraphs exhausted a 128 MiB child heap (SIGABRT). Probes now share one definition string and retain source only; render probes are short-lived, and one width's final mapped output is cached. The same bounded child now renders 8,000 rows successfully; measured first render ~3.2 s, cached repeat ~0.1 ms. A child-process heap regression is checked in. Private failing and passing probes are preserved; the logical source budget is not a V8 heap guarantee.
4. **Entering an evicted large body from below now targets its end**, retaining only the latest window while walking to EOF. A real RemoteViews/source-fragment regression asserts the final marker and no remaining after-window.

Fresh local typecheck PASS and **69/69 #82/#91 focused tests PASS** (42.8 s; no skips). Exact new SHA and CI/final review disposition are recorded on PR #96 after commit. Previous full local verify and exact-old-head Linux/macOS CI remain historical evidence, not claimed as new-head verification. No additional paid provider calls were made for these offline parser/cache corrections; live evidence above is unchanged.

**Outstanding, non-blocking acceptance acknowledgments (not silently approved):** after an oversized non-code block, conservative exceptional formatting continues through the region; acceptance also clears all Main undo/kill history, including a newer draft's undo steps created while the send was in flight (the current text remains). Both are disclosed in the run guide and must be shown to Master at acceptance. Native clipboard/font/IME and physical 80×24/120×40 remain NOT_TESTED.


## R6 findings and R7 corrections

Claude independently checked `9ebaed7dbfec47924ee662e4fc711efc4d27be6e`, passed typecheck and 69/69 focused tests, and accepted the hard-ceiling/deferred-placeholder and source-only reference-probe corrections as sound. It returned CHANGES_REQUIRED for two additional edge cases (raw private `review/r6-response-read1.md`).

- Uncached Up-entry no longer forces messages <=1 MiB into window mode. End targeting applies when the normal assembly actually becomes oversized; it chooses the latest non-whitespace window, while trailing source whitespace remains separately reachable. New 200,000/1,200,000-byte regressions assert full small-message equality and real nonblank end content, not just navigation markers.
- An empty math delimiter pair cannot be finalized as closed: Pi rejects the empty completed block and can treat the later tail as pending math. The stream now checks the closer against the actual content start after opener spaces/newline. Every-split cases cover empty dollar/bracket pairs and whitespace. Initial focused run caught a test-fixture issue: putting pending math first in the concatenated formatting corpus legitimately swallowed its later blocks, invalidating that fixture's >4-windows assertion despite exact render parity. These independent pending cases now remain in the every-split corpus without swallowing the separate multi-block rendering fixture; the failed run is preserved.

No additional product behavior or performance optimization was added in R7. Upward entry into a whole evicted message still lands at its top; reference-heavy first rendering remains synchronous (~3.2 s in the stress probe, repeated at a new width). These are disclosed non-blocking limits, not claims of seamless end positioning or responsive stress rendering. Final exact-head checks and review disposition are recorded on PR #96; Master acceptance and merge authorization remain separate.

R7 local validation: typecheck and docs/link/localization checks PASS; final focused #82/#91 suite **71/71 PASS**, zero skips, 42.9 s (`implementation/r7-focused-final.log`). R6's Linux/macOS/aggregate CI also passed on its own SHA (run 41067583328); it is not substituted for R7-head CI.



### R7 findings and R8 strict-parity corrections

R7 was **CHANGES_REQUIRED** on `2c32bfb3dd36e0bdd681481994f76d824953cf30`, despite independently passing typecheck and 71/71 focused tests. Exact-head CI run 41069915503 passed Linux, macOS and aggregate. The raw reviewer response is retained privately at `.demo-data/issue91/review/r7-response-read3.md`.

R8 pins the full unfinished nonblank math run to prevent premature setext splits. It retains the block tokens already parsed with lookahead, records a single last-math-start offset in the region index, restores affected adjacent-paragraph merging, resolves inline references with the completed region definitions, and invokes pinned Pi's checked block-rendering seam. This also fixes a separately discovered indented-paragraph normalization difference. Synthetic lookahead was rejected after a failing regression and is not in the delivered path. The proposed formatting exception was withdrawn; there is no new acceptance request or assumed approval for it.

New tests compare 2,500 fixed-seed documents at every source split and compare paginated rendering to whole Pi output; explicit tests cover interior blank rows, indented code, forward references, tables, nested blocks, math, and widths 1/8/24/80. Window-edge blank spacing is excluded only in the random display comparison; the original global-forward-math case compares interior rows exactly. The hard 4 MiB budget counts source/context, not derived rendering trees or total V8 heap. Tokens are never retained in checkpoints or the full-history index.

Final exact-head CI and Claude disposition are recorded on PR #96 after the code freeze. Earlier real-provider/PTY evidence remains scoped to its actual tested revisions; these parser corrections are offline-tested. Existing Master acknowledgment items (exceptional non-code formatting and clearing undo/kill history on accepted send), whole-message Up-entry top placement, and physical terminal NOT_TESTED status remain unchanged.

R8 final local validation: typecheck and docs/link/localization PASS; focused #82/#91 **79/79 PASS**, zero skips, 56.9 s (`implementation/r8-focused-final.log`). The seeded suite checks 2,500 documents; the full verification matrix runs on the pushed SHA in CI.

### R9 raw-span coverage and token-retention correction

An additional cost probe during R8 review identified avoidable repeated full-token filtering and window-array copies. Token assignment now walks monotonic block ends once; windows append tokens without rebuilding their previous array. On this Mac, a 30 KB / 10,000-short-paragraph BlockStream probe measured 1,410.5 ms before and 147.1 ms after; these are diagnostic samples, not latency guarantees. WindowStream measured 509.0 ms after, including its existing source/window handling. Raw before/after logs are retained privately. No parser semantics, API, quota, or acceptance scope changed. Typecheck and the same focused #82/#91 suite **79/79 PASS**, zero skips, 46.8 s. Final review must cover the new SHA rather than assuming the R8 verdict applies.

R8 reviewer returned **CHANGES_REQUIRED** on `938fc4a587aee1a649e57b514540d1974819f7a0`: Pi/marked can alter token.raw (insert newlines for `$$$$`, omit duplicate definitions), so the incomplete preserved-token list dropped visible content. The reviewer independently ran typecheck and 79 tests and reproduced missing sentinels through readMessageBody/SourceMarkdown; its raw response is private `review/r8-response-read1.md`. R8 Linux/macOS/aggregate CI nevertheless passed (run 41079261848), illustrating the missing coverage.

R9 requires exact contiguous raw-span coverage before retaining block authority; mixed windows discard partial lists. A non-tiling window is fully re-lexed and rendered through Pi tokens, with complete references and global future-math paragraph merging. This goes beyond the reviewer's suggested raw-window fallback, avoiding its identified interior blank-row difference. Those fallback rows conservatively anchor at the window start. Pure whitespace matches Pi's empty output; definition parsing precedes inline-lexer construction to avoid shared-tokenizer ordering dependence. The pre-existing early-anomaly exceptional-path trigger is disclosed in both plans and the run guide; it is included in the exceptional-formatting limitation awaiting Master acknowledgment.

Seeded vocabulary now includes duplicate definitions and `$$$$`; ambiguous modified raw strings cannot serve as an exact source-boundary oracle, but their source reconstruction and rendered output are still tested. Added every-split content-preservation cases, exact interior-row fallback comparison, and a >1 MiB end-target regression using the production reader/renderer with a synthetic cursor client (not a live Core/provider). All before/failure logs are retained. The final exact-head tests, CI and Claude verdict supersede the intermediate 79-test cost-only run above.

R9 final local validation: typecheck and docs/link/localization PASS; focused #82/#91 **82/82 PASS**, zero skips, 47.7 s (`implementation/r9-focused-final.log`).

### R9 findings and R10 anchor correction

R9 was **CHANGES_REQUIRED** on `6546dc3ae2502c53ff27f4aa9545d8de641f4745` despite exact-head Linux/macOS/aggregate CI PASS (run 41083370664). Claude independently passed typecheck, docs and 82 focused tests; verified the missing-content fix and exact single-window rendering over 38,472 source splits (1,394 fallback cases), and no missing content across 38,407 multi-window splits / 99,515 windows. It then found that fallback tokens shared a source start but restarted row numbering, so a same-width DocumentView re-render restored the first duplicate row pair and jumped upward. Raw verdict: private `review/r9-response-read2.md`. No acceptance was inferred from CI.

R10 keeps the row counter continuous across consecutive tokens with the same source start, resetting only when that start changes. Regressions assert unique fallback (block,row) pairs and same-width readMessageBody → messageComponent → DocumentView/AnchoredScroll stability on a >1 MiB end window. It also maps a first token at normalized offset zero to the original buffer start, including stripped leading ANSI controls; this avoids false fallback and fixes the reviewer's observed indentation-lookahead case. Every split of that ANSI/indentation source is tested at widths 8/40. The new tests were run against the original R9 production files and failed as expected before restoring the fix; logs are preserved.

Other nonblocking observations remain distinguished: definitions-only windows can omit Pi's cosmetic blank row; general fallback windows use coarse window anchors and re-lex local source, with the already disclosed exceptional-context scope. No new product feature, input quota, API or merge permission was added. Final exact-head CI and same-session review remain recorded on PR #96.

R10 final local validation: typecheck and docs/link/localization PASS; focused #82/#91 **83/83 PASS**, zero skips, 47.5 s (`implementation/r10-focused-final.log`). Against original R9 source, all three new/strengthened regressions failed as expected.
