# Terminal TUI

`npm run tui` opens Secretary in the invoking terminal. The client attaches to a separately running Core; it does not start or stop Core. The top status area, central messages and fixed bottom editor retain the Issue #82 layout and dark blue/light blue/error red palette. Native macOS Terminal/IME acceptance is **NOT_TESTED** until the [operator runbook](terminal-acceptance.md) is completed; Linux terminal use is experimental.

## Launch and exit

```sh
npm run tui -- --data /absolute/private/core-profile --mode fixture
npm run tui -- --data /absolute/private/core-profile --mode live --color auto
```

Use an existing, owned, mode-0700 profile without symlink path components, Node 22.19+ and `/usr/bin/python3` with `fcntl`. Both stdin and stdout must be a TTY. Run in the foreground. `--open` is obsolete and rejected. No browser server, URL, browser process or browser fallback is created. Core setup is described in the [operations guide](../operations.md).

`--config /absolute/private/config.json` accepts required `data` and `mode`, optional `color` (`auto`, `truecolor`, `256`, `none`), `quota` (8 MiB–1 GiB, default 256 MiB), `maxOutbox` (1–1000, default 1000) and `aliases`. The JSON file must be owned, mode 0600, outside the Core profile and have no symlink path components. Config-file and explicit CLI configuration are exclusive. Profile/mode never come implicitly from environment or current directory. Apple Terminal defaults to 256 colours; `NO_COLOR` disables automatic colour.

**Ctrl+C closes this client.** `/quit`, Ctrl+backslash, SIGINT/SIGTERM/SIGHUP and terminal loss also close it. Restoration of raw mode, autowrap, cursor and alternate screen happens before the bounded two-second save wait. SIGTSTP closes rather than suspends; Ctrl+Z displays a no-suspend hint. SIGCONT after a forced stop closes conservatively. SIGKILL/SIGSTOP cannot run cleanup: use your shell's `reset` if needed and reopen. Window close can be checked for durable reopen and released writer lock; its vanished screen cannot be inspected. Core and its tasks remain independent.

## Candidate keyboard controls

These bindings require native measurement before being frozen as supported. Enter inserts a newline in the editor; it never submits there. Ctrl+T enters a labelled action bar: Tab/arrows choose, Enter activates, Escape returns. F2 is an optional accelerator. Opening the bar never activates its selected action.

| Action | Candidate key / guaranteed application route |
| --- | --- |
| Submit / separate command buffer / literal mode | Ctrl+S / Ctrl+G / Ctrl+P; also action bar |
| Resume existing sends / import clipboard text | Ctrl+R / Ctrl+V; also action bar |
| Copy / Cut exact selection | Ctrl+O / Ctrl+X; also action bar |
| Undo / Redo | Ctrl+underscore / Ctrl+Y; also action bar |
| Move / line start or end | Arrows, Ctrl+B/F, Ctrl+A/E |
| Select | Action bar Set mark, move, Clear mark; Shift+arrows and Ctrl+Space are optional |
| Complete typed command token | Tab; never executes |
| Scroll messages | Ctrl+U/D; `/history`, `/latest` remain available |
| Expand/collapse paste at caret | Action bar; `/pasteblock <id> expand|collapse|edit|copy|remove` |
| Large edit Apply/Cancel; Copy/Restore record | Action bar, with existing explicit confirmations |
| Safe exit | Ctrl+C / Ctrl+backslash; `/quit`; action bar Quit |

Below 40×12, sending, Resume/retry, discard/restore, Cut, clipboard import and Apply are blocked. Safe inspection, command entry, scrolling, Escape and exit remain usable. Pending decisions and drafts remain intact. Returning to a usable size requires explicit Resume after the lease was rotated. No queued authority-bearing key crosses a large-edit decision: it is refused. Ordinary edits already queued before the prompt may resume after Apply/Cancel; subsequent input is visibly refused until the decision. An expired decision remains a recoverable refusal.

## Text, paste and clipboard

The canonical editor retains Main/Task isolation, provenance, grapheme boundaries and undo. CR/CRLF normalize to LF. Bracketed paste inserts data nodes; multiline nodes appear as labelled paste chips, with exact original text available for Copy/Cut. Displayed controls are escaped before terminal layout and never change stored/sent content. Tab expands to four cells for display. App Copy/Cut uses original text, not chip labels. The terminal owns IME preedit and candidate placement; PTY Unicode tests do not establish real IME behavior.

**Raw-terminal input does not authenticate its source.** Cmd+V is supported for trusted text only until actual terminal/version evidence establishes how embedded delimiters are transformed. A hostile clipboard end marker, terminal Reset/Hard Reset or lost paste mode can make pasted bytes appear typed and trigger actions. Reasserting modes is not authentication. These C2/C3 limitations require Master's acknowledgement before merge. The [historical G0 probe](../../src/pi_secretary/scripts/issue82-g0.ts) remains a failure witness, not the product adapter.

Use **Import clipboard text** to read text directly through bounded asynchronous `/usr/bin/pbpaste` and insert it as paste-origin data. Contents are not interpreted as keys or commands. This does not authenticate the key invoking import or fix mode loss. It is distinct from reserved `/paste`, which remains NOT_IMPLEMENTED. Copy uses asynchronous `/usr/bin/pbcopy`; Cut removes text only after successful delivery with the original revision, selection and local lease. Unsupported/failed clipboard access retains the draft. Linux clipboard operations explicitly return UNSUPPORTED.

The editor limit is 4 MiB; undo is bounded to 20 operations/512 KiB. A larger non-undoable edit requires Apply/Cancel. The framer caps paste text at 4 MiB and pending input at 8 MiB. Overflow discards through the end marker. Ten seconds of paste inactivity or an 8 MiB discard bound abandons incomplete input, reports the refusal and requires Resume. Returning to key parsing is a liveness rule, with the same raw-stream provenance limitation. No raw-input logging exists in the product.

## Commands, persistence and reading

Main Submit sends to Main. Task Submit saves its local draft; explicit `/send` routes it to Main. `/M` and `/T` retain separate drafts. `/send <text>` in the command buffer needs a second explicit Submit when replacing a nonempty draft. Escape cancels. Only a typed leading slash outside literal mode is parsed as a command; pasted command arguments remain data. Shell operators and newline command chains are rejected. `/help` lists the retained command set. Images, attachment UI and Task execution work remain outside this rollback; `/attach`, `/paste`, `/open` and `/cancel` remain NOT_IMPLEMENTED.

`SAVED` denotes the displayed draft's durable ACK. Queue admission, receipt, input state and model outcome remain distinct. Frozen request IDs and exact JSON bytes survive retry. All pre-existing entries require Resume; new Submit never implicitly resumes them. UNKNOWN blocks later entries; GET reconciliation alone cannot authorize body cleanup. A matching POST receipt allows durable handoff. NEEDS_EDIT can be restored with a two-step action; the rejected body remains retained. `/outbox`, `/outbox <id>`, `/outbox page:N`, `/outbox receipts:`, `/retry` and limited `/discard` retain their existing rules.

The version-1 `tui-v1` profile accepts exactly the old `browser-structured / issue82-r7` pair and new `terminal-bracketed-paste / issue82-terminal-r1` pair. Legacy producer labels, dates, IDs, body bytes, attempted/uncertain state, Main/Task undo/redo and receipts are preserved. Only new entries get the terminal pair. An older browser binary may reject new terminal entries; downgrade is not supported. Unknown pairs/corruption fail closed. A missing manifest with any retained files also fails closed. For an interrupted first commit, stop clients, preserve/copy the entire directory and manually move `tui-v1` aside only after deciding how to recover it; do not delete orphan files or treat this as automatic repair.

Stable reading anchors are retained on load and interpreted as wrapped-row offsets at the current width. Clamping/fallback is visible; old browser offsets cannot promise pixel-identical positioning. `/latest` resumes following output. Default bounded CoT preview, explicit `/cotvisible`, `/more`, `/select`, `/copy` and history synchronization retain the [ten Core API consumers](api-coverage.md). Protected records, quota, writer lock and three-calendar-year orphan retention remain unchanged.
