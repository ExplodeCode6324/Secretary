# FE-00 Mac spike evidence

Status: implementation and acceptance in progress; **GO_PENDING_MAC_TESTS**. Master authorized implementation and deferred Linux for this and later frontend issues on 2026-10-19. Linux is NOT_TESTED, outside the current gate. No Core protocol or user data is used.

## Implemented and observed

- Independent Tauri 2.12.4 / Svelte 5.57.2 / Vite 8.3.4 project with npm/Cargo locks and Rust 1.97.1.
- Ordinary Mac Release builds and opens a real WKWebView window. Document layout, stable textarea, three horizontal slices of one SVG outline, native zoom, reduced motion, variable-height recycling, synthetic streaming, and measurement/test controls.
- Default capability grants only main-window zoom and bounded study telemetry commands. Ordinary Release excludes driver dependencies and has no app-process TCP listener. Production npm audit reports zero advisories.
- Native-test feature has a separate build directory and embedded WDIO service. Its screenshots are from WKWebView, not Chrome.

## Verification so far

| Check | Result | Limits |
| --- | --- | --- |
| Svelte/TypeScript | PASS, zero errors/warnings | Frontend and test sources |
| Logic regression | 5 PASS | IME guard, exact drafts, safe Markdown, load fixture, phase frames |
| Native WKWebView | 6 PASS | Frames, reduced motion, synthetic WebKit IME order, range preservation across prepend, zoom |
| Ordinary Release security check | PASS | Default dependency tree, capability/CSP, main-process listener check |
| System Chinese IME | PARTIAL, gate NOT_TESTED | Native keys produced Chinese; Enter candidate commit, Space commit, Escape and independent Enter repeated; full seven-case payload/sequence matrix not yet signed off |
| Physical cross-viewport drag/copy | NOT_TESTED | Programmatic native DOM range passes; not equivalent to physical clipboard acceptance |
| Window resize/minimize/focus matrix | PARTIAL, gate NOT_TESTED | Real open and close/reopen observed; full matrix pending |
| Resource baseline | Pending | Must use ordinary Release without concurrent builds/tests |
| Core verify / CI | Pending | Existing Core jobs unchanged |
| Master visual / route second review | Pending | Cannot be supplied by automated frame checks |

## First failures and fixes

1. Initial native build failed because Tauri requires an app icon even with an empty bundle icon list. Added a small repository-owned SVG and generated only the required PNG/ICNS assets. Second build passed.
2. WDIO 10 CLI and Tauri service's WDIO 9 dependencies conflicted. Pinned the runner and service-compatible packages to WDIO 9; clean install and type checking passed. No `--force` or suppressed type errors.
4. OS-input recording exposed an accessibility click path: WebKit ended composition before click and committed romanized preedit. Added a no-key-after-composition-end click guard; its native regression passes. Physical/AX retest is in progress.

3. First native selection test failed: prepending 200 messages changed a Range stored as container offsets. Restoring the range from original node boundaries fixed the actual WebKit behavior; the same regression passed on rerun. Original failure preserved in `.demo-data/issue58-review/native-first.log`.

## Evidence

[Native run index](index.json) contains binary hash, source status, process identity, outcomes and artifact hashes. [Neutral frame](phase-0.png), [frame 1](phase-1.png), [frame 2](phase-2.png), [frame 3](phase-3.png) show the same geometric outline with displaced horizontal bands. JSON frame files contain clip/path/transform data and input geometry. Later runs preserve earlier failures in `.demo-data/issue58/runs/`; the index records which run produced these checked-in artifacts.

The binary may precede the final Git commit; its source-dirty flag is explicit. Refresh final build/evidence metadata before calling the issue complete. Raw logs and manual snapshots remain in Git-ignored `.demo-data/issue58/` and `.demo-data/issue58-review/`.

Test-tool dependencies currently have npm advisories inherited through WDIO browser-download/proxy packages; the embedded driver path does not acquire a browser. These are dev-only dependencies and not part of the bundled application. The full audit remains in the raw evidence directory; no production-advisory PASS is inferred for development tools.
