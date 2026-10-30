# Issue #82 rebuild — acceptance record template

2026-10-30. Planning only. Every product row is **NOT_TESTED**. Prior #82 results do not apply. Fill exact tested SHA and environment before execution; retain first failures and subsequent fixes. Code merge and product acceptance are separate decisions.

## Environment (to register before implementation preflight)

| Field | Value |
| --- | --- |
| Business baseline | f01076e6f5efad437d64b2a2890ae1af43ce97d7 (#81 rollback) |
| Planning base | ceb50543423e4cfabbbf532fed8432030fb8b061 |
| Tested implementation SHA | NOT_TESTED |
| macOS / terminal / version | NOT_TESTED |
| Node / installed pi-tui | NOT_TESTED; required Node >=22.19.0, pi-tui exactly 0.87.0 |
| Font / rows × columns / locale / actual input method | NOT_TESTED |
| Send / newline / exit / scroll / completion bindings | NOT_TESTED |
| Core mode / isolated data domain / task IDs | NOT_TESTED; no tokens or credentials in this record |
| Human performing actual IME confirmation | NOT_TESTED |

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
| Persistence | Atomic save, crash before/after POST/receipt checkpoint, timeout accepted by Core, actual NOT_FOUND, newer draft, disk failure, corrupt file, multiple writer, three-calendar-year expiry protection | NOT_TESTED |
| Repository | check, docs:check, targeted tests, verify with correct isolated PostgreSQL DSN | NOT_TESTED |
| CI / review | Linux Core, macOS including #82 targeted tests, exact-head Claude implementation review | NOT_TESTED |

## Requirement mapping

AC01 top-level navigation only; AC02 base layout only; AC03 default display only; AC04 Markdown; AC25/26 ordinary input/drafts; AC30 navigation/reading. Record delivered branches of AC24/28/31 individually. Full CoT, pending region, internal Task details and later batches remain unaccepted here.
