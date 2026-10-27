# Native terminal acceptance — Master-operated

Status: **NOT_TESTED**. This runbook checks the finished terminal candidate. PTY tests are synthetic byte tests; they do not certify physical shortcuts, Chinese IME or macOS Terminal clipboard delivery. Computer-use access to Terminal was denied; no alternate UI automation is used. Use only synthetic text, never a live profile or personal clipboard content. The clipboard fixture commands intentionally replace the clipboard.

## Prepare

1. In macOS Terminal, record `sw_vers`, Terminal About version, profile name, font/size, text encoding (UTF-8 required), `echo "$TERM / $TERM_PROGRAM / $TERM_PROGRAM_VERSION"`, keyboard function-key setting and English/Chinese input sources. Record the Git SHA with `git rev-parse HEAD`.
2. From the repository, start the isolated synthetic Core:

   ```sh
   node --import tsx src/pi_secretary/scripts/issue82-terminal-fixture.ts
   ```

   It prints a fresh private profile and an exact `npm run tui` command. Keep it running. In a second Terminal window run that printed command. The header must say `fixture`; never substitute your live profile. All model responses are synthetic. `acceptance-posts.jsonl` in the printed profile records each POST's request ID, byte count and exact base64 body.
3. Record the initial POST count (absent file means zero). The client must occupy this terminal with top status, middle messages and bottom editor. No browser should open. Keep the separately printed fixture profile path as `FIXTURE_PROFILE` for the checks below; it is synthetic, not a credential.

## Product checks

| Step | Action | Required observation |
| --- | --- | --- |
| 1 | Type `English 中文 😀 é`, use arrows, then Enter | Content and caret remain correct; Enter adds a newline; POST count remains unchanged |
| 2 | Select Chinese input source; compose, choose/confirm/cancel candidates using Enter/Space/Escape | Candidate confirmation never submits; no duplicate characters or accidental command; record actual bytes and candidate position |
| 3 | Compose while fixture output is streaming; test Ctrl+S and Ctrl+G during preedit | Record actual delivery and result; any candidate-confirmation submit blocks merge; unresolved unsafe interaction requires a code change |
| 4 | In the spare window run the benign clipboard command below; return and Cmd+V | One paste-origin chip, normalized newlines, unchanged POST count; expand via Ctrl+T action; exact content preserved |
| 5 | Ctrl+S once | Exactly one new request ID; decode recorded body and compare text; receipt and business outcome have distinct status |
| 6 | Ctrl+G, type `/T`, Ctrl+S; type Task draft; Ctrl+S; then `/M` | Task saves locally with no new POST; Main draft is distinct; explicit `/send` remains available |
| 7 | Ctrl+T, navigate all actions with Tab/arrows; Escape; repeat and Enter | Every required action reachable; opening the bar alone never activates anything; record Ctrl+T delivery. F2/Ctrl+Space are optional |
| 8 | Action bar Set mark; Ctrl+B/F movement; Copy; Cut; Undo; Redo; clipboard import | Original selected text is copied; Cut only after success; Undo restores provenance; import inserts data without submitting |
| 9 | Paste more than 512 KiB of synthetic text; observe Apply/Cancel; type and press Ctrl+S while prompt shown | Later input visibly refused; Apply/Cancel accessible; no delayed submit after decision; selected text and pending decision survive resize |
| 10 | Resize through 120×40, 80×24, 40×12 and below 40×12 | Layout preserves footer/caret; all authorization actions blocked when too small; inspection/exit work; resize back requires Resume |
| 11 | Scroll with Ctrl+U/D, receive new output, close and reopen | Older reading location remains stable by ID/wrapped row; fallback/clamping is visible; `/latest` follows again |
| 12 | Ctrl+C, `/quit`, SIGTERM from spare window | Shell cursor, echo, raw mode, autowrap and alternate screen restored; durable draft reopens; fixture Core remains running |
| 13 | Close the client window while synthetic draft is saved, then reopen the same command | Last durable draft survives; writer lock released; no orphan client/writer. Do not claim to observe restoration on a vanished screen |

Clipboard payload setup (run in the spare window):

```sh
node --import tsx src/pi_secretary/scripts/issue82-g0-clipboard.ts benign
```

For large-edit confirmation, use synthetic clipboard text:

```sh
node -e 'process.stdout.write("中文 large edit\n".repeat(60000))' | /usr/bin/pbcopy
```

To inspect synthetic POST bodies after a test (replace the path printed by the fixture):

```sh
node --input-type=module -e 'import fs from "node:fs"; const f=process.argv[1]; for(const l of fs.readFileSync(f,"utf8").trim().split("\n")){const r=JSON.parse(l); console.log(r.request_id,r.bytes,Buffer.from(r.body_base64,"base64").toString("utf8"));}' /absolute/printed/profile/acceptance-posts.jsonl
```

## C2/C3 raw-delivery classification — historical probe only

The product never logs raw input. In a separate test window run `npm run tui:g0`, which has no Core/network connection and logs **synthetic raw bytes** under the evidence path printed on exit. For each payload, run the clipboard setup in the spare window, Cmd+V into G0 and record trace, local submit count, exit behavior and any transformation:

```sh
node --import tsx src/pi_secretary/scripts/issue82-g0-clipboard.ts end-controls
node --import tsx src/pi_secretary/scripts/issue82-g0-clipboard.ts nested
node --import tsx src/pi_secretary/scripts/issue82-g0-clipboard.ts duplicate
node --import tsx src/pi_secretary/scripts/issue82-g0-clipboard.ts large
```

Run them **one at a time**, restarting G0 if a synthetic Ctrl+C exits it. Repeat benign and end-controls after Terminal Reset and Hard Reset, pasting immediately. Record raw trace classification: embedded end delimiter transformed/neutralized, delivered verbatim, or inconclusive. Observe the interval before modes are reasserted; absence in one attempt is not proof of authentication. Product clipboard import should also ingest these payloads as one paste-origin node with no submit.

Pre-declared outcomes: C2 verbatim or inconclusive selects trusted-text-only Cmd+V. C3 source loss is an acknowledged raw-stream residual. Neither is solved by an in-band confirmation. Master must explicitly acknowledge this narrower contract before merge. Undelivered mandatory bindings require code changes and delta review. Candidate confirmation causing Submit, an unreachable decision or raw/alternate-screen leakage blocks merge. Visual polish, colour nuance and emoji-width cosmetics may be deferred only by Master.

## Recording template

Record one row per step: commit SHA; OS/Terminal/profile/font/encoding/input source; physical keys or menu action; expected result; observed result; before/after POST count and request IDs; screenshot/trace/fixture evidence path; PASS/FAIL/NOT_TESTED; issue to fix. Native delivery, physical-key tests and synthetic PTY tests must be labelled separately.

Merge-blocking checklist: all decision routes delivered; C2/C3 measured and acknowledged; IME confirmation never submits; Ctrl+C and SIGTERM restore the shell; window-close durable reopen and lock release; no real-provider or live-profile data used. Keep this document and the PR at NOT_TESTED until these observations exist.
