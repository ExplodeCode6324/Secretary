# Local browser command interface

Issue #82 implements Main and local Task drafts in a loopback browser interface. It uses the existing Core API. The historical raw-terminal G0 remains an isolated failed provenance witness; it is not this product's input adapter. Product review, CI and manual acceptance are separate gates recorded in the [implementation evidence](../fix/evidence/issue82-tui/implementation.md).

## Start and stop

Start Core separately using the [Core operations guide](../operations.md). For a live Core, use the documented `npm run start:live` setup. The client never starts or stops Core, reads provider configuration, probes Core's lock, or opens another profile implicitly.

```sh
npm run tui -- --data /absolute/private/core-profile --mode fixture
npm run tui -- --data /absolute/private/core-profile --mode live --open
```

The explicit profile must already exist, be owned by the current user, have mode 0700, and contain no symlink path components. Node 22.19+ and `/usr/bin/python3` with `fcntl` are prerequisites; macOS also needs its existing Command Line Tools Python. Missing prerequisites produce an error without installing anything. `--open` targets an already installed Chrome/Chromium executable through fixed argv. It does not use a default browser or create/manage a browser profile.

Alternatively use `--config /absolute/private/config.json`, an owner-only mode-0600 JSON file outside the Core profile, with required `data` and `mode` fields. Optional fields are `quota` (8 MiB–1 GiB; default 256 MiB), `maxOutbox` (1–1000; default 1000), and `aliases` (fixed command-name mappings without arguments or collisions). Environment variables and the current directory never supply the profile or mode.

Open the printed single-use localhost URL in Chrome/Chromium 153 or newer. The launch token expires after 60 seconds. The page removes it from the address bar, stores a rotating reconnect credential in that origin's tab sessionStorage, and synchronizes its state before allowing actions. Core credentials remain in Node. One writer owns each profile's `tui-v1/` subtree. Another launch reports already running and does not take over.

Reload/reconnect has a 60-second recovery window. A duplicate tab may replace the current generation; the older tab becomes read-only and preserves its unacknowledged local edits for inspection. Reconnection never silently replays those local edits. Copy any displayed unacknowledged text before closing or reloading that tab. If the tab credential is lost or consumed without a completed handshake, wait for this client to exit and relaunch for a new URL. There is no terminal prompt or token-reissue command.

`/quit` explicitly submits a client shutdown. SIGINT/SIGHUP/SIGTERM also stop the client, attempting a bounded two-second flush. Browser close, power loss and SIGKILL cannot guarantee an unsaved edit survives; the last durable state remains authoritative. Core continues independently.

## Input and routing

The textarea is an input sink; the visible draft, caret, selection and undo belong to the application. Enter inserts a newline. Ctrl+S explicitly submits; Ctrl+G opens the separate command buffer; Ctrl+P toggles literal text; Ctrl+O copies the app selection; Ctrl+U/D scroll. Ctrl/Cmd+C never quits. Footer buttons provide explicit actions when a browser reserves a shortcut. The minimum viewport is 40 columns by 12 rows. Native shortcut interception and genuine OS IME remain platform-specific acceptance checks.

Composition preview is transient. Candidate confirmation does not submit or insert a second newline. A range that cannot be mapped safely, synthetic input, unsupported editing gestures, or an incomplete/invalid transaction cannot execute commands. Autocorrection/dictation with an ambiguous sink range is rejected visibly; the canonical draft is retained.

Plain-text paste, text drop and a supported middle-click paste create data nodes. Pasted `/quit`, terminal markers and control characters cannot become actions. CRLF and CR normalize to LF; remaining received text is preserved. The display neutralizes controls without changing stored or sent text. Multiline paste collapses into a chip; double-click expands it. Click or Shift-click sets the app caret/selection; arrows and Home/End edit that selection. Expanded paste edits retain paste provenance. Undo/redo keeps node provenance through save/reload.

Copy/cut uses the selected original text, not chip labels. Clipboard failures leave the draft intact. Cut deletes only after the clipboard write succeeds and the exact revision/selection still matches. A replacement exceeding the 512 KiB undo budget requires explicit “Apply without undo”; cancel preserves the draft. The draft limit is 4 MiB and undo is bounded to 20 operations/512 KiB. An edit that would exceed the draft limit is refused before offering confirmation; replacing selected text is allowed when the final normalized UTF-8 content fits. While this confirmation is open, the input is read-only: choose Apply or Cancel before typing, moving the caret, composing, or submitting. Input captured before the prompt remains queued and resumes in its original order only after that decision is acknowledged. Cancel keeps the original draft before applying those earlier queued intentions; Apply changes the frozen range first. Copy pending data remains available. After the decision closes the prompt, keyboard focus returns to the input unless you moved it to another control or the client entered recovery. An expired confirmation is refused without disconnecting the session. Refusal and lock reasons remain visible across background updates.

Main text submits to Main. Task text saves locally and explains `/send`; Task operations remain reserved for #83. `/M` and `/T` switch between distinct saved drafts. `/send` in the command buffer sends the current view's draft. `/send <literal text>` in that buffer presents a replacement candidate if the existing draft is nonempty; a second explicit Submit confirms. Escape cancels. In the ordinary draft, `/send <literal text>` removes exactly the command prefix and one ASCII space, preserving the remaining payload. `/send` never reparses payload commands.

Only a submission beginning with a typed slash outside literal mode is a command. Names are case-sensitive; arguments use explicit quotes and quote/backslash escapes. Unknown commands, pasted command arguments, shell operators, newline command chains and invalid scopes are errors. Tab only edits/cycles up to 20 completions and never executes one.

Refusal text is shown separately from the current outbox and notice status, so a pending Resume requirement remains visible. A completed fresh reconnect clears refusal text from the previous connection; background updates do not.

When input is locked, the lock reason and current outbox/Resume status remain visible. Copy pending data reports progress, success or failure in a separate recovery line. Success applies only to the snapshot captured at that click; later edits are not included, and copying neither saves nor resends the data. A failed copy leaves it in the tab. Reconnect with pending input explains that you must copy it before reloading; it never silently replays those edits. A completed fresh connection clears obsolete recovery feedback. Events from a retired connection cannot change the current connection; a genuine takeover of the current connection still makes the old tab read-only.

## Queue, recovery and reading

“SAVED” means the displayed draft revision has a durable writer ACK. Queue admission, HTTP receipt, Input state and assistant outcome have distinct labels. A whole message JSON body, including request ID and attachments array, must fit 1,048,576 UTF-8 bytes. C1 supports text only; a future nonempty attachment list is refused instead of silently dropped.

Each admitted request freezes its ID and exact serialized bytes before HTTP. The single dispatcher writes an attempt marker before sending and rechecks session authority after that fsync. A disconnect revokes future POSTs. Pre-existing entries require explicit Resume after reconnect; a new submit appends to the tail and does not Resume the queue. UNKNOWN blocks later entries. A validated pre-admission rejection becomes NEEDS_EDIT and retains its body. REQUEST_CONFLICT remains quarantined.

A lost receipt first reconciles with the original verified data domain, then replays the same ID and bytes so Core checks its payload fingerprint. GET status alone cannot free the body. A valid matching POST receipt permits durable receipt handoff and duplicate-body cleanup, even if later business execution fails. Cross-domain/API/mode mismatch permits inspection but prevents sending or cleanup under the new endpoint.

`/outbox` lists 50 entries; `/outbox page:2` continues. `/outbox <request_id>` opens a bounded preview and a **Copy record** button for its complete original text. NEEDS_EDIT also offers explicit two-step restore into the current draft; the rejected record remains retained, and edited text becomes a new tail intent only on Submit. `/retry <id>` preserves the ID/body; `/discard <id>` is limited to never-attempted or known-rejected requests. `/outbox receipts:` opens the receipt archive and prints its next cursor command. This archive does not count toward the 1000 unresolved-entry cap.

`/history [before|after]`, `/latest`, `/select <message_id>` and `/more <message_id>` operate on bounded Main data. Cold snapshots are stale/offline until fresh cursor/snapshot/catchup completes. Reading anchors use stable message/event IDs, not pagination cursors. Missing/reset anchors produce a notice and bounded fallback. Sync checkpoints are separate from protected input state and cannot authorize deleting an outbox body.

Default timeline reads use `thinking=false` and show the server's bounded thinking preview unchanged except for display safety. `/cotvisible [message_id] [on|off]` (alias `/cotv`) explicitly expands/collapses selected thinking; `/more <id>` loads another bounded batch. Each action allows at most four fragments/128 KiB retained decoded data, with a 1 MiB wire cap per response. `/copy <id>` copies complete body text only if that bounded batch completes it; explicit `loaded` permits copying the identified loaded segment. No background full-thinking prefetch occurs.

Protected draft/outbox content, unexpired orphans and receipt archives share the configured staging quota. The 2 MiB manifest, 4 MiB draft, 1000 unresolved-entry and 8 MiB derived-cache limits are independent. Capacity failure refuses new durable admission; it does not evict protected data. Unreferenced records without a durable supersession/discard/handoff ticket retain three calendar years in Asia/Hong_Kong, clamping Feb 29 to Feb 28. Corrupt/missing provenance is preserved. Only client-owned files inside `tui-v1/` are cleanup candidates.

The [API inventory](api-coverage.md) records the ten consumed operations and the other 76 operations outside this scope. `/cancel`, `/attach`, `/paste`, and `/open` return NOT_IMPLEMENTED for #83. No remote access, Core lifecycle control, browser-profile management, retired GUI restoration, or provider call is introduced by the client.
