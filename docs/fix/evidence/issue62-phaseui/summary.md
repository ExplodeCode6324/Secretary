# Issue #62 implementation evidence

Status: implementation and formal resource evidence prepared; final evidence review, final-head CI and Master acceptance pending. No merge authorization. macOS only; Linux desktop NOT_TESTED.

## Implemented surfaces

Production Connected now uses the PhaseUI shell, role avatars, buttons, input boundaries and structural dividers. Conversation remains mounted across navigation; Tasks and Pending use the same Work owner. Connection lifecycle controls moved into a native dialog with a disconnected prompt. Unsupported destinations remain empty. The Core assistant projection defaults to Secretary while preserving explicit lowercase spelling.

The typed renderer ports frozen v1.0 geometry and masked three-state reconstruction. Native freeze checks confirmed each of the three temporal groups for A/B/C; these are logical visibility checks, not display-time measurements. BASE is the production default; EXTENDED adds nav labels and the shared separator's keyboard/contact trigger. OFF also disables CSS transitions. Diagnostic launch validates selectors and makes real bridge construction unavailable.

## Validation so far (2026-10-21)

| Check | Result / limits |
| --- | --- |
| Core `npm run verify` | 616 pass, 41 PostgreSQL-dependent skips, 0 failure; 657 total. Docs/type checks passed. Remote CI must supply its configured database coverage. |
| Desktop contracts / Svelte | Contract check and type check passed, 0 warnings. |
| Desktop node / Python | 21 node tests, 6 Python tests passed, including controller ownership/coalescing/reduced-motion and invalid measurement rejection. |
| Rust | 1 launch-parser test and 29 integration tests passed; 1 subprocess crash helper ignored by design. Clippy passed. |
| WKWebView PhaseUI | 8 tests passed: A/B/C three-state visibility and masks; cleanup/OFF; divider gate/contact/global bound; navigation draft/scroll and synthetic composition guard; dialog focus; exact breakpoint widths, four zoom levels, dark mode. |
| WKWebView real bridge | 6 tests passed with isolated offline fixture Core: diagnostic view refused on normal launch, durable send, reopen/receipt, save retry after real storage rejection, responsiveness under blocked Core, stale stop rejection and explicit stop. |
| WKWebView reading | Offline Core anchor reload and subsequent durable replies passed. |
| Ordinary Release | Built successfully without native driver. Computer-use observed actual three-column layout, native controls, textarea/caret, brand fit and selected-row join. |
| System IME | NOT_TESTED: Simplified Pinyin and its shortcuts are installed/enabled. Final computer-use attempt showed underlined Latin composition text, but the candidate window was inaccessible and candidate confirmation was not verified. Earlier attempts showed English autocorrection. Synthetic composition is separate. |
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

The bilingual R2 plan is in `docs/fix/`; public component contract is `src/secretary_desktop/src/phaseui/README.md`. Run `npm run check`, `npm test`, Rust fmt/clippy/test, and ordinary `npm run tauri -- build` from the desktop project. Resource script is `scripts/phaseui_measure.py`; `phaseui_measurement_contract.py` rejects incomplete schedules and missing reports. Raw runs and review exchanges stay under ignored `.demo-data/issue62/`. Frozen source and binary hashes appear below. Final-head CI and reviewer disposition are recorded on PR #77 after the evidence commit, without changing the measured implementation.

## R3 review disposition (implementation)

Claude independently fetched `ebd7fc9`, read the non-document diff and frozen sources, and ran five source tests with Node type stripping plus an import hook (its npm installation was unavailable). It did not run native/Rust/resource/CI checks. Verdict: CHANGES_REQUIRED.

Accepted corrections: expired hover contacts now replay on press/Enter/Space/click; newly selected navigation plays its boundary; both submit routes play send feedback while `aria-disabled` prevents another submit without cancelling the current visual. Sidebar scrolls independently at enlarged zoom; vertical divider paths have a real selected-row gap. Capability inventory includes diagnostic view and ordinary-launch refusal has a native test. Gallery mode controls share state; visibility loss clears effects; divider hit testing is once per probe.

Resource methodology revision: rotate mode order per seed; all primary resource runs disable computed-style frame coverage sampling. Separate coverage cohorts report completed/covered/interrupted counts, reject coverage below 95% in the single/navigation diagnostic workloads, and remain explicitly logical visibility proxies. Cohorts enforce one binary hash. Completion/drain fields derive from fixture state. The input-scroll workload replaces the value every 500ms; it is not physical per-keystroke latency. Action latency uses the actual rAF callback execution time.

Retained adaptation: message/work/result/status/row boundaries preserve the real business UI's grouping while adopting PhaseUI primitives. Frozen conversation examples have fewer row separators; these additions are declared deviations and included in divider/probe cost. Master decides their visual acceptance.

## R4 review disposition

Claude re-read `4d710ea` and ran five source tests plus an input-event probe. It accepted the revised measurement method, but found bubbled input key/caret events replaying the field boundary and the sidebar edge moving with its scroll container. Input targets now react only to focus contact and explicit submission, with no pointer/keyboard/click replay; all target keyboard activation also rejects composing/keyCode229 events. A non-scrolling sidebar owns the full-height edge while an inner wrapper scrolls. Native tests assert no boundary effects from Space/Enter/composition/caret events, and verify edge geometry after scrolling at 200% zoom and all navigation targets at minimum height. Eight native cases passed. The arrow shaft's blue keyframe was restored too.

The six runs on `4d710ea` were only coverage calibration, not final resource evidence. All final cohorts must use the replacement binary.

## R5 and measurement calibration

Claude fetched `8e74ef4`, re-ran six source tests and its input probe, and returned PASS_PENDING_VALIDATION: production corrections were ready for the matrix, with final measurements/CI/manual acceptance separate.

Subsequent OFF calibrations exposed timer-callback-parity scheduling: only 80, 79 and 92 actions ran in 60 seconds, so the validator rejected all three. Foreground requests and manual raising did not establish a focus explanation (recorded background ticks were zero). These are retained as invalid calibration data, never final comparison runs. The replay now follows absolute clock deadlines from its existing instrumented rAF loop, at most one scheduled tick per frame, rather than assuming every interval callback arrives. Workload remains 60 seconds, 120 interactions / 240 bridge ticks / 1,200 stress ticks. Every non-idle run must complete its tick budget, stay within 250ms maximum schedule lateness, remain focused/visible, and recover cleanly. Reporting-off idle retains no rAF loop. The diagnostic window requests foreground focus; ordinary launch still refuses that command.

The replacement OFF calibration delivered 120 actions / 240 ticks, zero background ticks, max schedule lateness34ms and clean recovery. Mixed30/60Hz schedule regression passed; native suite8/8 and Release security checks passed. All pre-freeze runs remain calibration only. Input-scroll is still synthetic value replacement, and callback-time latency is not physical input latency.

## Frozen implementation and formal experiment

Implementation source: `e1efb80adf17919abe9d92cdb0d28d5ad99d5fea`. Ordinary Release SHA-256: `6314ae731beb89843a7f3dc0721e7568035be343f480a133b8335871ae27267b`. Evidence-only commits after this SHA do not change the measured implementation. Every valid run records a clean tracked worktree and this same binary. Native-test builds and all earlier calibrations are excluded.

The primary matrix contains 54 valid runs: six scenarios × three modes × three seeds, with mode order rotated. Separate logical coverage uses six runs. Reporting-off idle has nine process-only controls; its validity means readiness and the full sampling duration, not the report-based visibility, completion or recovery contract. Focused dark and narrow checks use the highest absolute CPU workload, stream-stress, for nine runs each. They are not complete matrices for those settings.

One additional primary attempt (bridge-cadence/OFF/seed64) emitted readiness but no report within180s; the runner correctly rejected it. Process CPU became near-zero after approximately40s. No thermal/performance warning was recorded, and no final visibility/focus report was available, so the cause remains undetermined. The exact unchanged seed/mode repeat completed240updates and120actions with21ms maximum lateness and clean recovery. The failed attempt remains public in invalid-attempts.json and is excluded only from valid-run aggregates; it is not silently erased or called a pass.

The main matrix shows a material resource cost during repeated navigation: candidate WebKit CPU median is7.28% OFF,16.16% BASE and17.35% EXTENDED. Candidate recovery-minus-baseline RSS medians are17.47,81.26 and108.25MiB respectively. Over three10-second recovery buckets RSS is approximately flat, and effect/node/timer counts are zero with listeners/targets restored to baseline. This establishes bounded recovery counters for these runs, not return of process RSS to initial values or a long-duration no-leak proof.

The absolute CPU-heavy stream workload has candidate medians25.09%,26.87%,27.72%; application medians2.36%,2.36%,3.41%. Input-scroll remains close across modes and does not replay input borders per update. Lower rAF intervals in animated single-control runs reflect callback cadence and do not prove faster physical presentation.

R6 Claude review independently read e1efb80 and ran seven source tests and two Python contract tests. It returned PASS_PENDING_VALIDATION, accepting the clock-deadline replay and diagnostic-only focus change. It did not execute native resource or system IME tests. The advice to compare callback latency only within compatible cohorts, keep foreground validity, and separate maximum lateness from any unmeasured percentile is retained here.


## Results and reviewable artifacts

- [Full comparisons, ranges and absolute deltas](resource-tables.md)
- [All 87 valid measurements](measurements.csv), [provenance](measurement-provenance.json), [one invalid attempt](invalid-attempts.json)
- [Ordinary Release light preview](native-light.png), [dark preview](native-dark.png). Artificial fixture data only; captured separately from timed runs. These are layout observations, not temporal-frame proof.

All 78 valid report-producing runs returned effects/nodes/timers to zero and listener/target counts exactly to baseline. All active schedules completed their expected update/action budget with zero hidden/unfocused ticks; maximum recorded schedule lateness was 51ms. Animation construction maximum was 10ms. Within compatible main-cohort comparisons, the largest mode difference of median p95 next-callback latency was navigation EXTENDED, +11ms versus OFF (36ms vs25ms), below the proposed one-refresh-interval investigation trigger. This synthetic callback latency cannot establish physical input latency or actual presented frames. `over_25ms` / `over_33ms` are callback-interval counts relative to nominal60Hz thresholds, not dropped display frames.

Reporting-off idle medians (application / candidate CPU) were OFF0.000%/0.928%, BASE0.000%/1.027%, EXTENDED0.017%/1.027%. Reporting-on idle was approximately2.1%/3.4–3.6%, so instrumentation overhead is material and disclosed; it is not mechanically subtracted from active workloads. Process sampler p95 cost across valid reported runs was57.7–62.0ms per approximately one-second sample. Reported-run phase windows aligned to report receipt have roughly one-second uncertainty. Reporting-off idle has no final report: its resource comparison uses process-relative seconds30–90, approximately matching the configured30s settle/60s active window. Initial evidence derived this window from process shutdown and was shifted about5s later; the nine controls were recalculated from retained samples, without rerunning or changing any measured code. All78 reported runs are unchanged. Existing shared WebKit resource values are retained separately in CSV. No exclusive WebKit ownership, total physical RAM, GPU/paint/energy, continuous thermal or long-duration leak acceptance is claimed.

Dark and600px narrow stress cohorts each passed9/9. Candidate CPU medians were24.13/25.86/27.20% (dark OFF/BASE/EXTENDED), and24.03/26.27/26.39% (narrow). These checks cover the highest absolute load, while the navigation resource delta remains a separate tradeoff for Master. BASE remains default and EXTENDED experimental; the measurements do not automatically accept their visual or resource tradeoffs.

System IME candidate Enter/Space/Escape, composing-send/Cmd+Enter, switch and streaming cases have **not** completed the planned three-repetition manual matrix. Computer-use could interact with the editor and navigation but did not expose/confirm the actual candidate panel; no system setting was edited. VoiceOver speech validation remains NOT_TESTED because no verified speech observation was obtained. These are explicit pending manual gates, not synthetic passes or waived criteria. Linux desktop remains deferred/NOT_TESTED.

The implementation-source CI at e1efb80 passed Core Linux, Core macOS, desktop macOS and aggregate verify. The evidence-only commit must also pass its CI before final delivery. Master retains final visual/performance acceptance and merge authorization; do not merge on the basis of this record alone.
