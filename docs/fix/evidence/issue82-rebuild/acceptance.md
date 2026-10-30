# Issue #82 rebuild — acceptance record

2026-10-30. Implementation and verification in progress. Standalone native input preflight passed with Master; full product rows remain unaccepted. Prior #82 browser results do not apply. Code merge and product acceptance are separate decisions.

## Environment (to register before implementation preflight)

| Field | Value |
| --- | --- |
| Business baseline | f01076e6f5efad437d64b2a2890ae1af43ce97d7 (#81 rollback) |
| Planning base | ceb50543423e4cfabbbf532fed8432030fb8b061 |
| Tested implementation SHA | Working tree; exact committed SHA will accompany implementation review |
| macOS / terminal / version | macOS 15.8.2 (24H225), Terminal 2.14 |
| Node / installed pi-tui | Node 22.22.0, pi-tui exactly 0.87.0 |
| Font / rows × columns / locale / actual input method | NOT_TESTED |
| Send / newline / exit / scroll / completion bindings | Shift+Enter / Enter / Ctrl+C; completion guard passed native preflight |
| Core mode / isolated data domain / task IDs | NOT_TESTED; no tokens or credentials in this record |
| Human performing actual IME confirmation | Master (standalone preflight only) |

## Product operations

| # | Steps and required observation | Direct failure | Evidence/status |
| --- | --- | --- | --- |
| N1 | Start native TUI attached to Core; Main send; from empty input /T and /M. At least one real running and one real waiting Task; true IDs/Scope/state; return to previous reading anchor. | Browser, empty/static Task, ACTIVE treated as RUNNING, /T inert, unwanted scroll reset. | NOT_TESTED |
| N2 | Duplicate navigation, root /back, grow width/height and restore. Input remains usable, single layout. | Extra hints/actions, sidebar/dual column, hidden editor, reading reset. | NOT_TESTED |
| N3 | Human enters Chinese with real system IME and confirms candidate; newline/send, wide glyphs, edit during streamed reply, fixed Markdown sample. | Candidate confirmation sends, lost text, format collapse, synthetic input offered as native evidence. | NOT_TESTED |
| N4 | Case-insensitive commands; Task /send; embedded and leading-space /T; /rawmessage /T followed by normal navigation; completion. | Wrong target, trim-induced command, persistent raw mode, completion submits. | NOT_TESTED |
| N5 | Task ordinary draft; exit/reopen starts Main; send Main to clear input, /T restores Task draft; append /M to Task text and submit. | Shared draft, auto-send, appended command navigates. | NOT_TESTED |
| N6 | Controlled failure and lost receipt; recover original request without duplicate; exit/reopen during real background Task. | Draft loss, duplicate input, client stops Core, acceptance mistaken for business completion. | NOT_TESTED |
| N7 | Quiet Main: navigate/help/complete/invalid arguments then ordinary edit clears error; compare authoritative history. | UI events create Master messages or audit records, model routes commands. | NOT_TESTED |

Task fixtures and virtual-terminal assertions are useful automation, but cannot replace N1/N3. Real-model/provider checks must record actual provenance; do not rename a fixture as live. Missing native evidence keeps issue acceptance open.

## Automated coverage to execute after approval

| Group | Required cases | Result |
| --- | --- | --- |
| Input | Actual Editor clear/trim, original leading whitespace, bracketed paste, multiline, autocomplete acceptance vs submit, backslash-newline, command scope/literal payload, double submit | NOT_TESTED |
| Rendering | Shared final/history renderer, Markdown sample, control sequences, tiny/large resize, editor cursor preserved, message/Task anchor refresh | NOT_TESTED |
| Task query | Running/waiting/no active/latest failed/Shared/queue count, additive schema compatibility, no state mutation | NOT_TESTED |
| Sync | Cursor reset, reconnect, stale generation, Core same-domain restart vs changed domain, delayed response | NOT_TESTED |
| Persistence | Atomic save, original raw input/bound-copy restore, accepted-before/after-restore and no Enter fallthrough, crash before/after POST/receipt checkpoint, timeout accepted by Core, same-instance NOT_FOUND vs later-instance proof, newer draft, disk failure, corrupt file, multiple writer, three-calendar-year expiry protection | NOT_TESTED |
| Repository | check, docs:check, targeted tests, verify with correct isolated PostgreSQL DSN | NOT_TESTED |
| CI / review | Linux Core, macOS including #82 targeted tests, exact-head Claude implementation review | NOT_TESTED |

## Requirement mapping

AC01 top-level navigation only; AC02 base layout only; AC03 default display only; AC04 Markdown; AC25/26 ordinary input/drafts; AC30 navigation/reading. Record delivered branches of AC24/28/31 individually. Full CoT, pending region, internal Task details and later batches remain unaccepted here.


## Native preflight and keyboard amendment — 2026-10-30

Master manually ran the standalone macOS Terminal preflight: Ctrl+J did not insert a newline; Shift+Enter and the other requested checks were reported normal (IME candidate confirmation, refresh while editing, command completion, resize, exit). The initial Ctrl+J handler ordering was corrected and its regression test passed.

Intermediate experiment: Master requested Enter for newline and Cmd+Enter for submission. Simulated Pi key-code tests passed, but Master’s native check subsequently found Cmd+Enter ineffective. The later Shift+Enter decision below supersedes this experiment. Protocol-level support did not establish Terminal support.

First dedicated simulated-terminal delay run: status GET injected with 2,000 ms delay, input-visible samples 22.0–24.1 ms, navigation 23.4 ms, status settlement 2,002.2 ms. No POST or new request ID was created. This is automated virtual-terminal evidence, not native hardware latency acceptance. Additional delivery tests cover slow persistence, late acceptance, newer drafts, same-ID retry, conflict, and negative status-read continuity guards. Full implementation and final review remain in progress.

Master subsequently tested Cmd+Enter: no feedback, while other checks were normal. Native Cmd+Enter is therefore **FAILED**, not accepted. Master selected **Enter newline / Shift+Enter submit**. Code, prompts and regression tests now use that decision. Native Shift+Enter-to-submit is **NOT_TESTED** (its earlier newline recognition passed); the preflight remains ready for confirmation.

## Implemented client operation ledger

| Operation | Purpose / write boundary |
| --- | --- |
| GET core | Attach to existing owner Core; validate API/domain/mode/instance |
| GET sync/cursor, GET sync/stream | Read-only invalidation stream and per-attempt continuity marker |
| GET timeline (limit 50, streaming), timeline/around, timeline after cursor | Initial recent window, refresh and catch-up of arrivals since the resident tail; no user history pagination |
| GET messages/{id}/content | Assemble fragmented displayed body with revision/generation guards |
| GET tasks (limit 50, cursor), scopes (limit 100) | Basic task pages, actual execution state/count, available Scope names; full scope navigation remains #83 |
| GET requests/{request_id} | Bounded read-only reconciliation; never auto-resend |
| GET sync/changes | Continuity check only for an unattempted later instance's negative request read |
| POST messages | Only an explicit Main submission with durably captured immutable request ID/body |

The TUI never starts/stops Core or sends Task drafts. UI navigation, completion, rendering and persistence create no Core business writes.

## Local launch

Start Core separately using the project's normal workflow and data directory. From the repository, run `SECRETARY_DATA=/absolute/path/to/core-data npm run tui`. With the default Core directory `.demo-data`, `npm run tui` suffices. The TUI attaches only. Local client state is under `~/Library/Application Support/Secretary/tui/v1/<domain>/<mode>/`, separate from Core.

Enter inserts a newline; Shift+Enter explicitly submits messages or commands. When completion is open, either key only completes; a subsequent Shift+Enter submits. Task ordinary submission retains its draft. Ctrl+C saves and exits the client; it does not stop Core. Small windows retain the bottom editor. Main and Task keep independent drafts and reading positions.

Current implementation verification is in progress. Full native Main/Task usage, live-provider behavior and exact-HEAD Claude review are not yet accepted. Earlier browser UI evidence is not acceptance for this rebuilt terminal client.

Master confirmed the final native preflight: all checks normal, with the question whether retaining editor text after submit was intentional. It is intentional in this standalone preflight (count-only, no Core). Thus native **Enter newline / Shift+Enter explicit submit / first-press completion isolation PASS**, reported by Master. This does not replace full product acceptance. The integrated client clears only the durably captured submitted draft and preserves later edits.


## Automation checkpoint

Twenty-two dedicated cases cover routing/paste/completion and final key bindings, simulated-terminal slow status latency, real HTTP lost receipt and timeout, slow persistence/new draft races, conflict, same-ID retry, acceptance-bound restore, continuity guards, writer exclusion, atomic snapshots, corruption preservation, expiry, reading anchors, burst catch-up, minimal actual waiting-execution projection, and attach/send/navigation/exit against a real fixture Core. These do not claim every matrix branch above, native full-product acceptance or live-provider coverage.

First integration attempt timed out because the reusable HTTP fixture did not publish a discovery endpoint file; the test setup now writes its own private endpoint file, as the actual Core launcher does. The initial burst test had an incorrect fake URL pathname (leading slash mismatch); correcting the fake made the 140-arrival test pass. No production route was changed to accommodate either fixture.

While a request is UNKNOWN, this one-slot client blocks different Main messages. It never automatically replays. Explicit identical-payload submission retries the original ID; verified later-instance non-delivery releases the slot and preserves the original raw input. A same-instance negative read or elapsed timeout alone never releases it. The client never restarts Core to force resolution.

Full local verification completed: 745 tests passed, zero failures/skips, using an isolated temporary PostgreSQL instance (now stopped). The final added integration/HTTP/keyboard and narrow-preview cases are separately rerun; final CI must cover the published HEAD.

The final exit-race regression verifies that input is disabled while the closing checkpoint is pending and re-enabled after a save failure, so displayed keystrokes cannot arrive after the final saved snapshot.

Master completed native integration against the isolated fixture Core: multiline Chinese send/reply and input clearing, actual RUNNING/WAIT_PRECONDITION Task objects and Scope/Shared, Main/Task navigation, exit/reopen and Task draft restoration were reported normal. This is native client + real Core routing with a controlled fixture provider, not real-provider validation. He requested optimization because exact slash commands appeared to need a trailing space. The parser never required that space; the completion menu consumed the first submit. Complete no-argument registered commands now suppress completion and submit once; partial commands still complete first. New regression covers the stale-menu race. Native confirmation of that last optimization remains pending.

Master reran the native client after the exact-command change and confirmed it meets expectations: `/T` and `/M` switch pages with one Shift+Enter and no trailing space; `/b` still completes first. Final keyboard/completion optimization native check **PASS**.

## Implementation review R4 — correction and regression

Claude Opus 5.5 Extra independently fetched `bfd6b20`, compared the attached source, ran the 22 targeted tests and typecheck in Linux, and reproduced two defects. Codex accepted both: real Core roles (`master`/`system`/`assistant`) and tool activity items now render explicitly; UNKNOWN sends request a read-only reconciliation and restore original raw input once per request, preserving restore intent across coalesced reads/reconnects. A bound retry stays visible until acceptance. No automatic POST, new-ID escape or same-instance negative-read release was added.

Related findings addressed: transient events refresh only timeline; committed invalidations select affected queries; unchanged revisions preserve assembled bodies; reconnect cannot re-enable editors during exit; failed Task pagination keeps the prior label/cursor; recovery hints include their path and clear after a subsequent accepted request; integration tests use an injected temporary state root; SIGHUP follows graceful close; three-year collection covers recognized orphan temp snapshots while protecting references; cursor movement no longer dismisses errors.

The expanded 27-case suite passed, including actual Core timeline role/tool rendering, same-instance restore/retry/late acceptance, restore coalescing across reconnect, selective SSE reads and fragment identity, failed paging, temporary-file expiry and error-hint lifetime. First follow-up run exposed an overly broad recovery-ID protection in collection; it was narrowed to temporary snapshots, retaining exact-file protection for recovery files. A test-only stream byte-array generic was corrected for typechecking. Native visual/controlled-failure/fast-typing rechecks remain pending on the corrected head. Real-provider validation remains NOT_TESTED.

Apple Terminal modifier limitation: Pi samples the live Shift state when processing a Return byte, rather than recording the modifier at physical keypress time. Native fast typing while a reply streams therefore needs an explicit check; passing it is not a proof against arbitrary event-loop stalls. This batch has only been exercised in local Apple Terminal. SSH/tmux and other terminal protocols are not accepted; do not assume Shift+Enter is transmitted there. Without a distinguishable modified Enter, this binding cannot submit.
