# Issue #82 — independent cloud G0 runbook (R5)

Run these commands yourself in your own isolated sandbox at the exact SHA provided in the review request. Report the actual OS, runtime and capabilities first. Codex's logs/screenshots are historical inputs, not your execution evidence. Do not use Master's Mac, existing Core data, production services or credentials. No new provider is required.

## Fetch and prerequisites

Repository: https://github.com/ExplodeCode6324/Secretary . Branch: `codex/issue82-tui-main`. Set `REVIEW_SHA` to the complete reviewed SHA in the accompanying request, then use a fresh sandbox clone:

```sh
git clone --no-checkout https://github.com/ExplodeCode6324/Secretary.git issue82-review
cd issue82-review
git checkout --detach "$REVIEW_SHA"
test "$(git rev-parse HEAD)" = "$REVIEW_SHA"
git submodule update --init --recursive
node --version
/usr/bin/python3 --version
npm ci --ignore-scripts
mkdir -p .demo-data/issue82-tui/cloud-review
node --import tsx src/pi_secretary/scripts/issue82-g0-environment.ts > .demo-data/issue82-tui/cloud-review/environment.json
```

Requires Node >=22.19, fixed `/usr/bin/python3` with fcntl, POSIX PTYs/signals. macOS checks CLT presence before invoking its Python shim; Linux does not call xcode-select or sw_vers. No auto-install is performed by the probe. Record missing runtime/dependency/DNS/access capability with its first failure and exact exit code. Do not quietly change source or substitute another checkout. Official package/runtime setup inside your own sandbox is permissible if you can do it; record versions and changes. No host deployment or global machine changes are requested.

The Linux helper uses `PYTHONUTF8=1` and `LANG=C.UTF-8`; record installed locales. Fonts, display variables and terminal type are inventory, not proof of working GUI or IME. Linux clipboard is explicitly UNSUPPORTED: no pbcopy/xclip/wl-copy/native addon/OSC52 is invoked there. Return code 2 from the clipboard fixture is expected capability unavailability, not a successful clipboard test.

If the registry is unreachable, retain the first `npm ci` failure and keep the exact checkout/lock unchanged. A separately documented source build or preinstalled dependency may be used only as exploratory evidence under your normal sandbox permissions. Record every version, source commit, build command, nonzero attempt and missing npm integrity check. Label all dependent results SUBSTITUTED_ENV; never call them locked-install/typecheck PASS. A check using a different compiler or missing dependencies is INVALID_ENV until reproduced in the pinned environment. Do not conceal a first failure with a later successful substitute or change package pins merely to make the sandbox pass.

## Independent functional and rendering checks

```sh
npm run check
node --import tsx --test --test-concurrency=1 test_case/offline/issue82/g0.test.ts
/usr/bin/python3 test_case/offline/issue82/g0-pty.py "$(command -v node)" .demo-data/issue82-tui/cloud-review/pty.json
node --import tsx src/pi_secretary/scripts/issue82-g0-render.ts .demo-data/issue82-tui/cloud-review/pty.json
```

Preserve stdout/stderr and exit code of **each** command. The PTY driver produces new private `run-*` evidence roots and ten ANSI frame captures (all 80/120/40 columns × 24/40/12 rows, plus 30×10). It uses the actual G0 entrypoint with synthetic continuous output and pasted CJK/emoji/combining text; it checks normal exit, actual PTY hangup, parent SIGKILL and writer-lock recovery. Existing output report paths are rejected to preserve first failures.

The renderer consumes those exact ANSI captures using pinned `@xterm/headless@5.5.0`, then emits cell-position SVG, text and hashes. The pipeline is **actual probe → PTY byte capture → headless terminal cells → SVG**. Inspect the SVGs yourself with whatever image/browser tool is actually available in your sandbox and supply your screenshots/rendered artifacts, paths/hashes and observations. Font requests in SVG do not establish installed glyphs: record the actual viewer/fonts, missing-glyph behavior, CJK/emoji widths, clipped controls, fixed footer and resize. The SVG helper currently maps RGB and default foreground only, uses a fixed dark background, and does not model all terminal styling, mouse selection or IME candidates. It cannot approve 256/16-color themes or native rendering. Codex's local SVG-to-PNG showed an inadequate emoji glyph fallback; evaluate your own font environment instead of copying that image or calling it PASS.

No display server is needed for the PTY/cell checks. If your tools cannot actually display generated images, mark visual inspection DEFERRED with that limitation; generating an SVG alone is not independent visual approval. PTY/SVG success is never macOS Terminal/IME success.

R4 independent inspection found that headless 5.5.0's default Unicode 6 table assigns emoji a different width from pi-tui. Until an aligned width table is deliberately selected and verified, emoji-row geometry and associated scrollbar alignment are NONREPRESENTATIVE; a font glyph rendering successfully does not fix cell width. The report's `footerPresent` field searches for “DRAFT” only; it does not assert row position, visibility of every footer control or geometry. Inspect the actual frames separately.

## Real terminal capabilities, if available

Run `npm run tui:g0 -- --help`, then `npm run tui:g0` in an actual terminal emulator in your own sandbox. Report emulator version, font, locale, rows/columns and input method. Test physical/virtual key events through its GUI, candidate windows if a Chinese IME actually exists, copy/selection/resize, and Reset followed immediately by paste. Pasting finished Chinese strings does not test composition. Linux results do not approve Apple's IME.

The supported raw-input protocol remains unresolved. The preserved witness feeds an embedded `ESC[201~` followed by a later chunk of Ctrl+S/G/C; these become keys. Passing that witness unit test means the defect is reproduced. It remains FAIL_PROTOCOL_PROVENANCE. You must assess the functional disposition in the R5 plan separately from visual deferral.

If an actual Linux xterm/X server is available, a candidate to evaluate is a process-local xterm resource policy that blocks paste ESC/ETX/BEL/DC3 and other action-control bytes even with bracketed paste disabled. The upstream xterm manual documents `allowPasteControls` and `disallowedPasteControls`: https://invisible-island.net/xterm/manpage/xterm.html . **This is a candidate, not an approved replacement or a verified default.** Record exact build/configuration and test its real clipboard delivery and Reset. Do not identify safety from TERM or a one-time probe, or mistake xterm.js headless emulation for the xterm GUI program. Do not enable an unsafe synthetic event permission merely to get a test to run.

The Mac fixture tool can prepare benign/end-controls/nested/duplicate/large payloads. On Linux, independently create the same synthetic clipboard text through a verified GUI clipboard path if one exists, then paste using that emulator's own paste action; direct writes to the PTY bypass the producer being tested and are insufficient. Payloads are in `src/pi_secretary/scripts/issue82-g0-clipboard.ts`; never paste secrets or shell commands. Capture delivered bytes and action counts. Stop the actual scenario at the first unintended submit/command/exit; preserve it. No real Core is connected by this probe.

R5 requires the exact full resource exclusion list and launcher/channel identity proposal in the plan. Test two separate properties: (1) pasted controls cannot directly dispatch actions, and (2) paste text/tabs retain data provenance even after Reset and a subsequent genuine submit. The second property is not proved by filtering C0. If actual terminal evidence is unavailable, give a source-grounded disposition and assess the proposed structured browser adapter, with its explicit scope change, instead of claiming the raw parser is safe.

The delegated coordinator permits one bounded, unprivileged private xterm/X-library build from fixed public xterm/xenocara sources already inspected, under your normal authorization mechanism, solely in your temporary sandbox. Record complete source commits/hashes before running configure. Xvfb, a self-written Xlib selection owner and XTEST delivery are in scope; unsafe SendEvent must remain off. No system paths, Master-host access, credentials, network-policy changes or extra permissions. This is delegated scope confirmation, not human approval and not permission to bypass a sandbox refusal. If execution remains blocked or your platform requires human approval, preserve the exact rejection, do not route around it, mark REAL_LINUX_TERMINAL NOT_TESTED/DEFERRED and continue feasible source/plan review.

## Required review output

1. Exact SHA; independently observed OS/runtime/GUI/terminal/font/clipboard/IME capabilities.
2. Each command, exit code, first failure and what you actually inspected/executed. Separate upstream facts, Codex evidence and your evidence.
3. Artifact names/hashes plus actual screenshots/rendered images where possible. Distinguish HEADLESS_EMULATION, REAL_LINUX_TERMINAL and REAL_MAC_IME.
4. PASS/CHANGES_REQUIRED for R5 plan readiness, including a specific technical disposition of raw-input provenance and the concrete P2 proposal if needed. Identify which commands would be disabled on an unverified input producer; no timing heuristic, in-band confirmation or self-asserted `--trust-terminal` bypass. A read/edit-only terminal is a degraded mode, not the accepted final #82 Main deliverable.
5. Visual/IME items unavailable solely due to sandbox capability are DEFERRED/NOT_TESTED and nonblocking under Master's 2026-10-25 authorization. Functional defects still need a reliable boundary or repair. Do not maintain the superseded mandatory-unlocked-Mac gate.

The next step is coordinator disposition, then product implementation with full validation, API inventory, exact PR HEAD review and actual Linux/macOS CI. This preparation is not a PR or merge approval.
