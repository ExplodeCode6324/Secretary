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
