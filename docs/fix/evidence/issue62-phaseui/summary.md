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
| Desktop node / Python | 20 node tests, 6 Python tests passed, including controller ownership/coalescing/reduced-motion and invalid measurement rejection. |
| Rust | 1 launch-parser test and 29 integration tests passed; 1 subprocess crash helper ignored by design. Clippy passed. |
| WKWebView PhaseUI | 8 tests passed: A/B/C three-state visibility and masks; cleanup/OFF; divider gate/contact/global bound; navigation draft/scroll and synthetic composition guard; dialog focus; exact breakpoint widths, four zoom levels, dark mode. |
| WKWebView real bridge | 6 tests passed with isolated offline fixture Core: diagnostic view refused on normal launch, durable send, reopen/receipt, save retry after real storage rejection, responsiveness under blocked Core, stale stop rejection and explicit stop. |
| WKWebView reading | Offline Core anchor reload and subsequent durable replies passed. |
| Ordinary Release | Built successfully without native driver. Computer-use observed actual three-column layout, native controls, textarea/caret, brand fit and selected-row join. |
| System IME | NOT_TESTED: installed input sources include Simplified Pinyin, but computer-use attempts only produced English autocorrection, not a verified Chinese candidate session. Synthetic composition is separate. |
| VoiceOver | NOT_TESTED; accessible names, modal focus and hidden-state checks covered through native automation. |
| Master aesthetics / performance decision | Pending, never inferred from automated checks. |

First failures retained under ignored `.demo-data/issue62`: initial Svelte declaration/prop issues, test helper's omitted bounds argument, and missing `phaseui_view` capability registration. Each was corrected and the affected check rerun. Native-test builds are not resource baselines. R3 adds real activation feedback, scroll reachability and diagnostic refusal tests. The minimum-height first failure exposed subpixel viewport rounding (0.8px); the assertion now permits one CSS pixel after waiting for resize/zoom completion.

## Deviation ledger

- Connection utility/dialog and minimal role avatars adapt the real FE-02 workflow as approved in R2; full page work remains #63–#66.
- Text buttons reconstruct only their real underline. Keyboard focus now also has that underline, while retaining its outline. Bordered controls reconstruct actual boundaries; no new rectangles.
- Pending is static text, replacing the prototype's infinite scanner. OFF disables both animations and transitions.
- Owned empty layers replace body mutation observation. Scroll cancels dividers only, so send feedback survives automatic latest-message scrolling.
- The default Secretary name is longer than frozen PERRI. Brand size is 22px (20px vertical narrow), with title/aria-label for truncated custom names. This adaptation is explicitly submitted for review, not silently treated as identical typography.
- Resource stream stress is a bounded in-page workload. At drainage its synthetic transient is removed to return to the initial row set for recovery; this is not durable Core finalization. Real bridge finalization has separate fixture evidence.

## Reproduction and provenance

The bilingual R2 plan is in `docs/fix/`; public component contract is `src/secretary_desktop/src/phaseui/README.md`. Run `npm run check`, `npm test`, Rust fmt/clippy/test, and ordinary `npm run tauri -- build` from the desktop project. Resource script is `scripts/phaseui_measure.py`; `phaseui_measurement_contract.py` rejects incomplete schedules and missing reports. Raw runs and review exchanges stay under ignored `.demo-data/issue62/`. Final source SHA, ordinary binary SHA-256, CI and reviewer disposition will be recorded after the candidate is frozen.

## R3 review disposition (implementation)

Claude independently fetched `ebd7fc9`, read the non-document diff and frozen sources, and ran five source tests with Node type stripping plus an import hook (its npm installation was unavailable). It did not run native/Rust/resource/CI checks. Verdict: CHANGES_REQUIRED.

Accepted corrections: expired hover contacts now replay on press/Enter/Space/click; newly selected navigation plays its boundary; both submit routes play send feedback while `aria-disabled` prevents another submit without cancelling the current visual. Sidebar scrolls independently at enlarged zoom; vertical divider paths have a real selected-row gap. Capability inventory includes diagnostic view and ordinary-launch refusal has a native test. Gallery mode controls share state; visibility loss clears effects; divider hit testing is once per probe.

Resource methodology revision: rotate mode order per seed; all primary resource runs disable computed-style frame coverage sampling. Separate coverage cohorts report completed/covered/interrupted counts, reject coverage below 95% in the single/navigation diagnostic workloads, and remain explicitly logical visibility proxies. Cohorts enforce one binary hash. Completion/drain fields derive from fixture state. The input-scroll workload replaces the value every 500ms; it is not physical per-keystroke latency. Action latency uses the actual rAF callback execution time.

Retained adaptation: message/work/result/status/row boundaries preserve the real business UI's grouping while adopting PhaseUI primitives. Frozen conversation examples have fewer row separators; these additions are declared deviations and included in divider/probe cost. Master decides their visual acceptance.

## R4 review disposition

Claude re-read `4d710ea` and ran five source tests plus an input-event probe. It accepted the revised measurement method, but found bubbled input key/caret events replaying the field boundary and the sidebar edge moving with its scroll container. Input targets now react only to focus contact and explicit submission, with no pointer/keyboard/click replay; all target keyboard activation also rejects composing/keyCode229 events. A non-scrolling sidebar owns the full-height edge while an inner wrapper scrolls. Native tests assert no boundary effects from Space/Enter/composition/caret events, and verify edge geometry after scrolling at 200% zoom and all navigation targets at minimum height. Eight native cases passed. The arrow shaft's blue keyframe was restored too.

The six runs on `4d710ea` were only coverage calibration, not final resource evidence. All final cohorts must use the replacement binary.
