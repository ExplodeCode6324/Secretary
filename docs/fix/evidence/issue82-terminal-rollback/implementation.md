# Issue #82 terminal rollback — implementation evidence

Status: implementation candidate; native macOS Terminal/IME and Master C2/C3 acknowledgement **NOT_TESTED**. No merge authorization. Full-suite/CI and exact-HEAD implementation review are recorded separately when complete. This document does not turn a plan PASS into product acceptance.

## Scope and review

- Base main: `e090a9c79f69fc68cb4b81caa392e1b82675cf34`. Plan R3 PASS: `493ec825d8bbddbafb20cabe0c86bd008feb6607`, browser Claude Opus 5.5 Extra, same session throughout.
- Keep #79 retirement, #80 outcomes/reasoning and #81 Core image pipeline. No attachment UI or Task execution claim. Keep canonical editor, commands, writer durability, outbox dispatch algorithm and history synchronization.
- Replace formal browser server/DOM assets/launch with current-terminal input, rendering and restoration. Small presentation port retains app orchestration. Old browser files and tests remain available at the base commit; no executable browser fallback remains. Direct ws dependencies removed.
- The input stream is framing, not authentication. Fatal incremental UTF-8, capped paste and pending input, explicit confirmation routes and local lease rotation are tested. C2/C3 residuals and the native gate are in the [guide](../../../tui/terminal-guide.md) and [runbook](../../../tui/terminal-acceptance.md).
- Both exact producer pairs are accepted; legacy entries are never relabelled. Missing/corrupt manifests and unknown pairs fail closed. The committed synthetic browser-r7 fixture was generated before changing the loader; source commit and source-file hashes are embedded.

## Verification ledger

Evidence root (ignored): `.demo-data/issue82-terminal-rollback/`. Test commands use isolated synthetic profiles and this task's independent PostgreSQL instance, not Master's live profile.

| Check | Evidence/result |
| --- | --- |
| Original focused editor/outbox/sync/writer/performance/G0 | `baseline-first.log`: 76/76 |
| Original #80 and #81 input/provider | `core-baseline-first.log`: 46/46; not the full image suite or a real provider |
| Full unchanged baseline, including PostgreSQL | `full-baseline-first.log`: 832/832, zero failure/skip; types and docs passed |
| Historical G0 PTY/ANSI | `g0-pty-first.json`, `g0-render-first.log`; limitation witness, not product/native acceptance |
| New stream tests | `terminal-stream-first.log`: 6/6, including expected split-marker limitation |
| Legacy compatibility + input | `terminal-model-second.log`: 18/18 |
| Expanded compatibility/input/render | `terminal-focused-third.log`: 27/27 |
| Retained and new Issue #82 tests at intermediate candidate | `issue82-first.log`: 116/116 |
| Real fixture Core integration, including two-step rejected-body restore | `core-terminal-first.log`: 2/2 |
| Actual npm product PTY | `product-pty-sixth.json`: 14 paths PASS, including exact single POST, no paste/newline auto-submit, visible decision, resize/lock exclusion, native-addon refusal, Node/tsx/npm/group signals, repeated signals during slow flush, background preflight, hangup and SIGKILL reopen. Background preflight enters no modes; SIGKILL/hangup cannot promise output restoration. |
| Actual ANSI → xterm/headless 5.5.0 cells | `product-render-first.log`: header, fixed editor/footer, Chinese/emoji text, paste chip and cursor checks pass; no native font/IME claim |
| Types / current localized docs | `check-fifth.log`, `docs-second.log` passed at intermediate candidate |
| Native Terminal, physical keys, OS clipboard/IME, Reset/Hard Reset | NOT_TESTED; committed Master-operated runbook required before merge |
| Real provider | NOT_TESTED; outside this rollback |

## First failures and disposition

- `legacy-reopen-first.log`: copy fixture directory mode was 0755; restored private permissions on the test copy. Original fixtures unchanged.
- `check-first.log`: initial adapter types and old browser-test references; fixed while migrating retained assertions. No type exclusions added.
- `terminal-compatibility-first.log` / `second.log`, `terminal-input-first.log`: harness used a non-`tui-v1` basename and macOS symlinked temporary path. Fixed harness layout/realpath; writer restrictions retained.
- `terminal-render-first.log`: assertion expected two-digit control labels, but the retained editor uses four-digit labels. Corrected the assertion, not sanitation.
- `product-pty-first.log`: macOS slave PTY ioctl becomes unavailable after its controlling session exits. Mode assertion now queries the master, verified with an isolated ioctl probe.
- `product-pty-third.log`: duplicate writer correctly reported `TUI_ALREADY_RUNNING`; harness expected a lowercase string. Corrected assertion; no takeover or lock weakening.
- `product-pty-fifth.log` and `background-observation.log`: **product defect**, background terminal read hung after entering alternate screen. Added foreground preflight before writer/mode entry and startup-close guards. Expanded PTY rerun records the result; no acceptance waiver.
- Direct git transport failed HTTP2/TLS during plan publication. Published identical trees through GitHub API, preserved the initial local commit on a backup branch and aligned local/remote SHAs. No network/security settings changed.

## Retained browser-test intent

Browser Origin/token/socket/DOM/composition simulation tests retire with that client. InputProtocol's structured-paste/partial-transaction test is retained verbatim in `input-protocol.test.ts`. Mixed controller regression assertions (chunk ACK bounds, large edit expiry/repeated decisions, large draft performance) now use the presentation event port. Terminal tests replace applicable adapter assertions: prior queued ordinary text versus later refused input, no authority replay across decisions, visible refusal through repaint, empty paste preserving selection, action-bar paste as data, delayed clipboard stale selection/generation, clipboard failure retaining draft, over-capacity refusal and explicit recovery. Native IME is not simulated as browser composition.

## Delivery gates

Run complete post-change verification, Linux/macOS CI and same-session exact-HEAD review. Native runbook results and Master acknowledgement remain mandatory before merge. Master decides merge separately. Existing historical evidence and unrelated local data are retained.
