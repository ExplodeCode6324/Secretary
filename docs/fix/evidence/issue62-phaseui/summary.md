# Issue #62 implementation evidence

Status: implementation candidate; resource matrix, Claude implementation review and Master final review pending. No merge authorization. macOS only; Linux desktop NOT_TESTED.

## Implemented surfaces

Production Connected now uses the PhaseUI shell, role avatars, buttons, input boundaries and structural dividers. Conversation remains mounted across navigation; Tasks and Pending use the same Work owner. Connection lifecycle controls moved into a native dialog with a disconnected prompt. Unsupported destinations remain empty. The Core assistant projection defaults to Secretary while preserving explicit lowercase spelling.

The typed renderer ports frozen v1.0 geometry and masked three-state reconstruction. Native freeze checks confirmed each of the three temporal groups for A/B/C; these are logical visibility checks, not display-time measurements. BASE is the production default; EXTENDED adds nav labels and the shared separator's keyboard/contact trigger. OFF also disables CSS transitions. Diagnostic launch validates selectors and makes real bridge construction unavailable.

## Validation so far (2026-10-21)

| Check | Result / limits |
| --- | --- |
| Core `npm run verify` | 616 pass, 41 PostgreSQL-dependent skips, 0 failure; 657 total. Docs/type checks passed. Remote CI must supply its configured database coverage. |
| Desktop contracts / Svelte | Contract check and type check passed, 0 warnings. |
| Desktop node / Python | 19 node tests, 5 Python tests passed, including controller ownership/coalescing/reduced-motion and invalid measurement rejection. |
| Rust | 1 launch-parser test and 29 integration tests passed; 1 subprocess crash helper ignored by design. Clippy passed. |
| WKWebView PhaseUI | 6 tests passed: A/B/C three-state visibility and masks; cleanup/OFF; divider gate/contact/global bound; navigation draft/scroll and synthetic composition guard; dialog focus; exact breakpoint widths, four zoom levels, dark mode. |
| WKWebView real bridge | 5 tests passed with isolated offline fixture Core: durable send, reopen/receipt, save retry after real storage rejection, responsiveness under blocked Core, stale stop rejection and explicit stop. |
| WKWebView reading | Offline Core anchor reload and subsequent durable replies passed. |
| Ordinary Release | Built successfully without native driver. Computer-use observed actual three-column layout, native controls, textarea/caret, brand fit and selected-row join. |
| System IME | NOT_TESTED: installed input sources include Simplified Pinyin, but computer-use attempts only produced English autocorrection, not a verified Chinese candidate session. Synthetic composition is separate. |
| VoiceOver | NOT_TESTED; accessible names, modal focus and hidden-state checks covered through native automation. |
| Master aesthetics / performance decision | Pending, never inferred from automated checks. |

First failures retained under ignored `.demo-data/issue62`: initial Svelte declaration/prop issues, test helper's omitted bounds argument, and missing `phaseui_view` capability registration. Each was corrected and the affected check rerun. Native-test builds are not resource baselines. Subsequent small presentation additions require final snapshot rerun before delivery.

## Deviation ledger

- Connection utility/dialog and minimal role avatars adapt the real FE-02 workflow as approved in R2; full page work remains #63–#66.
- Text buttons reconstruct only their real underline. Keyboard focus now also has that underline, while retaining its outline. Bordered controls reconstruct actual boundaries; no new rectangles.
- Pending is static text, replacing the prototype's infinite scanner. OFF disables both animations and transitions.
- Owned empty layers replace body mutation observation. Scroll cancels dividers only, so send feedback survives automatic latest-message scrolling.
- The default Secretary name is longer than frozen PERRI. Brand size is 22px (20px vertical narrow), with title/aria-label for truncated custom names. This adaptation is explicitly submitted for review, not silently treated as identical typography.
- Resource stream stress is a bounded in-page workload. At drainage its synthetic transient is removed to return to the initial row set for recovery; this is not durable Core finalization. Real bridge finalization has separate fixture evidence.

## Reproduction and provenance

The bilingual R2 plan is in `docs/fix/`; public component contract is `src/secretary_desktop/src/phaseui/README.md`. Run `npm run check`, `npm test`, Rust fmt/clippy/test, and ordinary `npm run tauri -- build` from the desktop project. Resource script is `scripts/phaseui_measure.py`; `phaseui_measurement_contract.py` rejects incomplete schedules and missing reports. Raw runs and review exchanges stay under ignored `.demo-data/issue62/`. Final source SHA, ordinary binary SHA-256, CI and reviewer disposition will be recorded after the candidate is frozen.
