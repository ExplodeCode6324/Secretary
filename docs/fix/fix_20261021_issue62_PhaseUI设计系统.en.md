# Issue #62 · PhaseUI design system implementation plan

Status: R2 approved by Master — implementation and validation in progress; final review and merge authorization pending. Date: 2026-10-21. [中文](fix_20261021_issue62_PhaseUI设计系统.md). [Issue #62](https://github.com/ExplodeCode6324/Secretary/issues/62).

### Decisions presented for Master approval

- Integrate production components into Connected: default Conversation, connection/stop controls in a separate Connection dialog, existing business blocks mapped in section10; full pages remain #63–#66.
- Three frames follow actual v1.0 construction: real borders for bordered buttons, existing underlines for borderless text buttons, wrapper boundaries for inputs; no added rectangles. Pending uses static text/icon; minimal role avatars reach the real conversation.
- BASE already covers existing dividers. EXTENDED adds left labels and extra keyboard/contact triggering of the same .nav-separator, not new lines. Trial p=0.25; production remains BASE until Master chooses after comparison.
- Lower minWidth640→480 for native narrow-window checks; diagnostics/acceptance controls provide zoom/text-scale. Resource runs use one ordinary Release binary for three modes, with in-page stress, bridge-cadence simulation and real fixture tests explicitly distinguished.
- One Core projection default changes from lowercase to Secretary, preserving explicit names; update API tests/examples/docs, with no schema/storage migration.

Implementation starts only after approval; later native aesthetics, performance acceptance and merge remain separate Master decisions.

## 1. Authority, scope and baseline

Use secretary-pr-fix in fix mode. Reviewer: browser Claude, Opus 5.5 Extra (verified in UI), English communication, same review conversation throughout this task. If the account/model becomes unavailable, report the exact blocker and ask Master whether to fall back to local Hermes; never switch automatically. Raw requests/replies/screenshots go in ignored `.demo-data/issue62/review/`; publish only sanitized findings. Review is readiness to implement, not product acceptance or merge authorization.

Secretary baseline is `4f1f052` (PR #76); #61 has merged and its Master/CI gate is complete per #62. The old pending wording retained in the #61 documents describes their publication stage, not an outstanding gate. Issue #62 is assigned to ExplodeCode6324. Recheck upstream before implementation and review any material drift.

Authority: [current docs/frontend](../frontend/README.md), applying Master's R1 decisions, and the frozen design [v1.0.0, 8cdb9219bed9493147ba10f7d47423df56cbcc44](https://github.com/ExplodeCode6324/secretary-phase-ui-design/tree/8cdb9219bed9493147ba10f7d47423df56cbcc44). Consult its final CSS, geometry, controller and screenshots whenever a visual detail is uncertain. Do not modify the frozen tag. Current Core/bridge contracts govern business behavior; prototype data and fake sends do not.

macOS desktop only; Linux desktop deferred / NOT_TESTED. Core Linux CI remains. Deliver reusable components, native shell, gallery, experiments and measurements. Preserve FE-02 capabilities; full conversation/task/memory-settings/artifact-notification pages remain #63–#66. No Core redesign, device work, live-model spending or production deployment is needed.

## 2. Source and computer-use findings

Read the six current frontend specifications, desktop entry, Connected/Phase/style and measurement harness, plus frozen README, UI-DESIGN, TAURI-MOTION-COST, geometry and controller. Browser observation this round used the frozen checkout served over loopback: wide light/dark conversation, selected directory join, activity column, fixed A first/second/third frames, and release of the freeze. The frames show different gaps/slices; screenshots do not establish millisecond timing. Native computer use observed the already-open FE-02 connected window without sending or reconnecting: it remains a vertical utility interface with retained cached data. Its binary provenance was not re-established, so this is UI observation, not acceptance of the current source.

| Existing source | Finding and planned treatment |
| --- | --- |
| `src/secretary_desktop/src/main.ts` | Ordinary launch mounts Connected; study mounts App. Production PhaseUI must reach Connected, not just App. |
| `Connected.svelte` | Owns draft/version, queue, generation, transient polling and reading anchors. Keep this business owner alive through navigation. Current textarea has composition handlers but no Cmd+Enter handler; implement approved shortcut with regression coverage. |
| `Phase.svelte`, `study.ts`, `style.css` | FE-00 technical sample and old green layout; not production authority. Scope old CSS to study and add canonical PhaseUI styles, preventing global selector leakage. Preserve historical study tests as such. |
| `Conversation.svelte`, `Message.svelte`, `Work.svelte`, `Results.svelte`, `workflow.ts`, `bridge.ts` | Reuse projections, safety, persistence, receipts, artifact saving and selection behavior; replace presentation incrementally. |
| frozen `prototype.js`, `signal-motion.js`, final `style.css` | Port stable geometry, actual source gaps and controller semantics into typed modules; do not copy whole-page innerHTML rendering or cumulative CSS overrides. |
| `scripts/measure.py`, WDIO and native-test configuration | Existing harness targets FE-00 study. Extend with an explicit PhaseUI scenario and mode metadata; never label the old study measurements as new components. WDIO binary is not a resource baseline. |

This round does not claim new native IME, animation timing, performance, accessibility or all-breakpoint passes. All implementation acceptance below starts NOT_TESTED.

## 3. Component structure and integration

Proposed root: `src/secretary_desktop/src/phaseui/`. Add `tokens.css`, `geometry.ts`, `motion/{plan,renderer,controller,divider}.ts`, Svelte components and a documented public export surface. Keep business queries out of this library. Component inputs are view data, stable IDs, semantic state and callbacks; callbacks dispatch immediately and exactly once, never from animation completion.

| Family | Deliverable / behavior |
| --- | --- |
| Shell, DirectoryItem, ActivityRail, Brand | Three columns, native window controls, stable page regions, directory links with aria-current; display name from existing assistant projection, trimmed empty fallback Secretary, accessible full long name, no “main session” label. |
| Icon, Button, TextLink, Input/Composer, Tabs | Stable geometry and native semantics; primary/secondary states; tab arrow/Home/End behavior where actual tabs are used, not misapplied to navigation. Stable textarea DOM, selection and IME. |
| Divider, ListRow/TaskRow, ArtifactRow | Edge-aligned structural lines, compact rows and inline expansion; file name with metadata; stable row keys, expansion state and focus. |
| Dialog/Confirm, Status/NotificationBar, Activity/Progress | Focus entry/trap/Escape/return, clear result text, determinate progress only with real values; no fabricated completion. NotificationBar is a primitive, not #66 delivery implementation. |
| Avatar, gallery and four consumer examples | Master/assistant image semantics; examples for #63 conversation, #64 task/decision, #65 settings form, #66 artifact/notification. Synthetic data is confined and visibly labeled in gallery. |

Extract only final effective v1.0 rules into tokens: light document/sidebar #fffcf6/#f5f2ea, dark #000000/#141414; exact ink/muted/line/blue/light-blue/red/green from current visual spec; system fonts, 14px/1.65, monospace brand/time, brand hard text edges without box. Document spacing/density/line/state/duration tokens with source references. Token values can be tuned centrally only with recorded design review, never per-page alternatives.

Shell widths: 196 / minmax(0,1fr) / 270; at <=1100, 166/230 sides; collapsed right 48; <=850 default collapsed and expanded overlay; <=600 left 64 and vertical brand. Selected row uses document color and truly interrupts the vertical border. Structural lines reach their own module edges. Right rail groups ongoing/recent artifacts/quick actions as one surface. Unimplemented features retain labeled empty locations; no fake counts or executable-looking unsupported actions.

Integrate shell and primitives with the existing connected workflow, preserving every existing entry to conversation, tasks/approvals/results and Core lifecycle controls. Add the six navigation destinations and an opt-in development gallery route (not an ordinary navigation item). Move existing business blocks into appropriate regions through presentation adapters; unsupported pages stay empty. Keep the data/session controller mounted. Save and restore per-view scroll/ID anchors; hide inactive reading/composer surfaces without duplicating IDs or exposing hidden focus targets. Do not expand the bridge whitelist or fetch unavailable pages for empty slots. Use the existing assistant subscription and contract; no name-derived relationships.

## 4. Three logical frames and lifecycle

Port fixed source paths separately from auxiliary geometry; generate unique mask/clip IDs per instance. While a slice moves, remove its original location from the visible base. Three display layers are not three temporal frames: temporal states start at 0%, 26.67%, 53.33%, intact at 80%; second reverses/changes region, third narrows/reduces offset. Use discrete segment transitions, not a single steps(1) swallowing intermediate frames.

Durations: icons A/B/C 160/180/200ms, small icons 140ms, brand and both avatars 180ms, send square 160ms, composer boundary 140ms, divider 150ms. The original send arrow's 420ms projection is the one specified exception. Boundary/panel reveals use frozen rules without moving text.

One effect record per control; choose random parameters once at activation. Merge hover/focus/press within one contact; pressed feedback is immediate, release continues that effect. A new distinct interaction replaces old work, never queues replay. Pointer departure/drag cancellation, pointercancel, blur/window loss, disabled, unmount, mode changes restore source and dispose animations, timers, nodes and listeners. Clean dividers on scroll/resize. Temporary layers use aria-hidden and pointer-events:none; no per-frame IPC or idle animation loop.

Stable/hover/focus/pressed/disabled and idle/pending/succeeded/failed/offline/stale are orthogonal; cover only applicable combinations. Receipt/business data determine success, not visual reset. Pending must not disable reading/navigation. reduced-motion, weakened/off/outline modes restore intact display without replay; focus/current/disabled/error remain visible. Avatar is not a fake focusable button.

Composer: native textarea, Cmd+Enter and send button share existing send pipeline; plain Enter inserts newline. Guard composition/isComposing and composition-confirmation event ordering without a blanket delay that swallows a subsequent independent Cmd+Enter. Persist draft/outbox before clearing only the matching version; errors retain text; animation cancellation does not cancel a submitted request. Preserve selection/caret and domain/generation protections.

## 5. Left text and divider experiment

Modes in the same build: OFF (decoration off), BASE (full specified three-frame coverage including brand, avatars, input boundaries and existing structural dividers), EXTENDED (BASE plus left navigation text and an alternative activation treatment for the existing navigation group separator). The precise shared-target experiment is defined in section 10; it does not pretend a new separator exists. Never add lines just to animate them.

Extended text uses a temporary, nonsemantic clipped display layer with a genuine source gap; retain original layout, hit target, accessible name and full text access. Verify long Chinese/Latin/mixed labels and narrow vertical brand. Default production remains BASE until Master chooses the extension after comparison.

Divider: event proximity around 7px, <=18px segment, ~1px offset, 150ms, 700ms per-line cooldown and one global active divider. Add a separate yes/no random gate; random slice selection alone is insufficient. For a reproducible initial experiment use p=0.25, explicitly a trial value to be adjusted from observation, not an approved aesthetic constant. Draw once per eligible approach, including misses, and require exit/re-entry plus cooldown before a new decision so pointermove frequency cannot force eventual playback. Inject a seeded RNG for tests/measurements, then test natural randomness. No background polling. Keep selected-row gaps and hidden/occluded lines intact.

## 6. Gallery, regression and native acceptance

Gallery covers all component states, themes, names, canonical geometries, A/B/C, frame 1/2/3 freeze, natural playback, cancellation, motion modes, OFF/BASE/EXTENDED, and four independent consumers of public exports. Freeze controls are diagnostics, not timing proof. Screenshots use fixed seed, viewport, font, zoom and data; capture source + three frames + reset, and selected/hover/focus/pressed/error examples. Review images against pinned design references with an explicit deviation ledger; do not silently rebaseline screenshots.

Unit/controller tests target real failure modes: gaps and stable path, unique IDs, no duplicate action, contact merging, cancellation and cleanup, deterministic random miss/cooldown/global divider limit, state changes while an effect runs, reduced-motion toggle mid-frame. Add Svelte/native integration cases proving hidden pages do not receive focus, navigation preserves draft and anchors, failed persistence retains text, and transition completion cannot report business success. Reuse existing contract, workflow, bridge, reading and native suites as regression coverage.

Real macOS Tauri matrix: both themes; 1100/850/600 breakpoint ±1 and exact width; wide/narrow usable examples; native WebView 100/125/150/200% zoom and enlarged text; central flex/fixed side widths; window controls; keyboard Tab/Shift+Tab, Enter/Space activation and dialog focus; accessible names/status with VoiceOver where available. Check both avatar effects, fast alternating controls, pointer cancellation, disable/unmount, scroll/resize and turning motion off mid-effect. Text selection, caret, candidate placement and layout remain stable.

System IME: candidate confirm by Enter/Space, Escape cancel, mouse send during composition, window switch, independent Cmd+Enter after confirmation, and composition during fixture streaming. Each repeated three times, zero unintended sends and exactly one valid commit with exact text. Synthetic composition tests are separate and cannot establish system IME pass. Master reviews aesthetics and perceptible stalls in the real Tauri window. No browser screenshot can substitute.

## 7. Native performance experiment

Extend the existing measurement harness rather than invent resource claims from node counts. Ordinary Release, same binary SHA, isolated synthetic data and explicitly selected PhaseUI measurement route; native-test driver absent. Normal product mode has no recurring sampler/telemetry. Any measurement-only configuration follows existing restricted study IPC, not a generic shell/network bridge. Functional native automation and resource runs are separate.

Five scenarios: idle (30s settle +60s sample); repeated single control; rapid cross-control/navigation; typing plus scrolling; fixed fixture stream plus interaction (nominal 20 updates/s, 1,200 updates, actual drain, 30s recovery, 180s deadline). For active nonstream runs use a fixed 60s schedule plus 30s recovery, at least 100 recorded activations when applicable. Replay is synthetic and labeled; manual input latency is a separate observation. Include cancel/unmount cycles and post-quiescence counts. Run OFF/BASE/EXTENDED at least three times per scenario, rotating order; same seed, viewport, DPR, theme, zoom, data, event schedule and powered/thermal conditions. Main benchmark uses one declared fixed theme/window; repeat focused worst-case checks in the other theme and narrow mode, not mislabel as full matrix.

Record build/device/macOS/WebKit provenance, viewport/DPR/refresh where available, settings, sampling overhead and run validity. Capture construction/update durations, event-handler to next rAF as an explicitly labeled proxy (not confirmed presentation time), click feedback proxy p50/p95, frame interval distribution and >1.5x/2x refresh-budget counts. Use native timeline tools for paint/composite/event-to-presentation where available; unsupported PerformanceObserver/Long Tasks/GPU/energy metrics remain NOT_TESTED. Do not call rAF intervals “actual dropped display frames.” Report every run plus median/range and absolute delta vs OFF; avoid percentage-only summaries.

Process sampling includes app and WebKit candidates, separating preexisting shared processes and PID lifetimes as current harness does. Report CPU, peak RSS and recovery, not exclusive ownership or true total RAM from summed RSS. Record effect/node/timer/listener counts: after cancellation/route cycles and quiescence they must return to baseline with no monotonic growth or background animation work. Run a reporting-off idle control to quantify instrumentation overhead; record video/screenshots separately from timed runs.

Investigate any lost/duplicate action, missed cleanup, visible input displacement or reproducible latency/long-frame regression. Proposed investigation triggers, not pre-approved product SLOs: BASE/EXTENDED p95 feedback > OFF by one measured refresh interval, any animation-construction task >50ms, or sustained resource growth after recovery. Compare compatible FE-00/02 data with their build/workload caveats. Optimize construction, reuse and cleanup while preserving three logical frames; do not silently reduce to two. Master decides aesthetics/acceptable measured tradeoffs. Missing native core metrics or unresolved regressions prevent claiming performance accepted.

## 8. Execution, checks and gates

1. Finish bilingual plan and Claude review; resolve comments in this same plan. Stop for Master's implementation approval.
2. After approval: recheck baseline, create a codex branch, inventory exact source tokens/components and isolate study CSS. Implement tokens/shell and component primitives.
3. Port typed geometry/controller; add gallery and focused behavioral tests. Integrate existing FE-02 presentation and Cmd+Enter while retaining business owners.
4. Implement experimental extension and deterministic mode controls. Run native visual/input/lifecycle coverage, then ordinary Release performance comparison. Record failures and retests, not only final passes.
5. Update current docs/frontend, component usage and acceptance evidence; update localization inputs and regenerate supported language views through the existing localization process. Keep uncertain/deferred results explicit. Resolve stale current-stage wording without rewriting historical evidence.
6. Run desktop `npm run contracts:check`, `npm run check`, `npm test`, production build and applicable Rust fmt/clippy/test; existing native suites plus new PhaseUI suite and isolated fixture integration. Run repository docs/check/verify requirements and existing Core Linux/macOS plus desktop macOS CI. Exact command surface is rechecked before execution; no paid live-model run for this design-system scope.
7. Implementation PR is reviewed by the same Claude conversation against exact HEAD, diffs and evidence. Report what reviewer actually inspected/ran versus Codex evidence. Master final native visual approval and explicit merge authorization remain separate gates; do not close #62 as complete before its acceptance is met.

## 9. Additional source audit included in R1

`application-service.ts:822` already maps a blank stored assistant name to lowercase `secretary`; `test_case/offline/issue8/api.test.ts:125,148` assert that behavior. A UI-only `trim() || "Secretary"` cannot distinguish this fallback from an explicitly configured lowercase name. Propose one narrow Core presentation correction after approval: return `p.name.trim() || "Secretary"` from the existing assistant projection, preserving every explicit nonempty name (including lowercase `secretary`). Update the two default-name assertions and add explicit-lowercase/whitespace checks. No schema, storage migration, endpoint, authorization or state-machine change. Document the default response text change and run API plus Core regression checks; do not hide it as a CSS change. The frontend still handles absent/blank projections with Secretary while respecting explicit names. This correction is included in the plan submitted for Master approval.

Additional browser observation: at a temporary 599px viewport, the right rail overlays the body when expanded and restores reading space when collapsed; the left rail becomes icon-only with vertical branding. Viewport override was reset. This does not establish all breakpoint/native passes.

Current plan-only checks and review record will be appended below. No production code has been changed or performance acceptance claimed.

## 10. R1 resolutions and concrete implementation decisions

Claude R0 returned CHANGES_REQUIRED after inspecting both pinned repositories and frozen screenshots. It did not run tests, serve the prototype or launch Tauri. The following changes resolve B1–B5 and N1–N11; they are concrete proposals included in Master's pending plan approval, not new unapproved implementation.

### B1 · Real-window boundaries

Default destination is Conversation, including when disconnected. Right activity rail is present only on Conversation (frozen `prototype.js:252`); other destinations use the remaining central width. A small “Connection” text control in the existing top utility strip opens a token-styled native dialog; it holds the existing profile/lifecycle controls. This is a declared extension because v1.0 has no live connection controls. The status strip shows concise sync/error state and a connection entry; full diagnostic detail is in that dialog. It does not implement Settings. Keep the current app identifier `dev.secretary.study` and existing data roots; do not rename/migrate profiles or databases.

| FE-02 block | #62 destination and treatment | Full-page owner |
| --- | --- | --- |
| Profile select, attach/start, sync/errors | Connection dialog; existing callbacks, status/errors remain visible outside as appropriate | Shared shell / #62 |
| Stop Core and confirmation | Connection dialog; separate explicit confirmation, preserving instance binding | Shared shell / #62 |
| Timeline/composer/history/latest | Conversation center; tokens/primitives and minimal role avatars; stable existing projection, draft/outbox and anchor behavior | #63 |
| Tasks/execution details | Tasks center; preserve current selection/detail interaction, restyle with primitives | #64 |
| Execution results/artifact save | Within selected task execution detail, same save workflow | #64 details; #66 full library |
| Approvals | Pending center, preserve existing read/confirm/receipt semantics; extract view from Work without duplicating its state owner | #64 |
| Outbox/receipts | Pending center, clearly separate from approvals; preserve current command list and receipt labels | #64 |
| Memory/settings/artifact-library | Named empty page slots; existing artifact save remains reachable through Tasks | #65 / #66 |
| Right rail groups | Preserve v1.0 positions; read-only data only if already available and correctly related, otherwise empty | Later page owners |

#62 adds simple real timeline avatars because Master explicitly requires both-avatar coverage; defer full date-grouping/timeline redesign to #63. Role labels are Master for master/user, configured assistant name for assistant, System for system. Use first Unicode grapheme (Intl.Segmenter when available, safe code-point fallback) from a nonempty display name as an initial; stable full accessible role/name, no remote image/API. Keep system identity distinct. Full task-table interaction redesign, sorting/filtering/pagination redesign, artifact library, decision answering, search and notification delivery are not #62. Row/table primitives and all states still exist in the gallery for later consumers.

Gallery is enabled only by the explicit whitelisted `SECRETARY_PHASEUI_SCENARIO=gallery` selector returned through study_mode; it is available in the same Release binary when opted in, not in normal navigation. It imports production components and labels synthetic content. Normal launch remains Connected. No business action is available from the gallery.

### B2 · Coverage matrix and deliberate source adaptations

R1's coverage overrides the frozen CSS-only gaps: bordered text-only buttons receive a three-frame fault on their real border; borderless text-style buttons receive it only on their existing underline; input focus uses the real bordered wrapper. Each proposed effect is 140ms, with text and hit regions stationary and no invented rectangle. Master approves that concrete visual adaptation with this plan; no need to reverse the already-approved all-button/input scope. Ordinary text links retain v1.0 static underline/bracket feedback; actual button controls use the construction-based rules below, never a tag-based outline. Filter groups retain aria-pressed semantics; a future actual tablist uses tab keyboard semantics. No invented tab behavior for existing filters.

| Target | BASE mechanism / events / duration | Frozen source and change | OFF / EXTENDED |
| --- | --- | --- | --- |
| Glyph-bearing controls | Glyph slice, hover/focus/contact press-release; A/B/C160/180/200, small140 | geometry prototype.js:1; signal-motion.js:822 | OFF none; EXT same |
| Bordered text-only buttons (.button) | Three-frame fault replaces only the real border; hover/focus/press-release140; suppress decorative bracket pseudo-elements during the fault, restore on finish/cancel | style.css:461,1590–1680; boundary renderer adaptation | OFF no fault; EXT same |
| Borderless text-style buttons (.text-button) | Three-frame fault only on the existing hover/focus underline,140; source underline has a real gap; no perimeter/rectangle; decorative underline expansion is replaced during this effect | style.css:378 underline; three-frame line renderer adaptation | OFF static semantic underline; EXT same |
| Inputs/selects | Real bordered wrapper only, focus/contact140, submit boundary140 for composer; owned empty sibling layer inside wrapper, never children of textarea/select; no effect per keystroke | style.css:1565 four-step redraw replaced by R1 three-frame boundary | OFF none; EXT same |
| Brand and both avatars | Identity slices180; existing hover/focus where semantically focusable, no new avatar tab stop | signal-motion.js:537 | OFF none; EXT same |
| Send | Square160 and arrow420, same record/contact; accepted activation immediately submits | signal-motion.js sendEffect | OFF none; EXT same |
| Selected nav boundary | Boundary on actual navigation; frozen boundary timing; merges with glyph record | signal-motion.js play/navigation | OFF none; EXT adds label slice |
| Structural lines incl. .nav-separator | Event proximity, gated,150; cooldown700, global one | signal-motion.js:600–820 plus R1 yes/no gate | OFF none; EXT alternative below |
| Left nav labels | No label fault in BASE | .nav-label in prototype.js:226; identity mechanism as source | OFF none; EXT same A/B/C duration as its glyph |
| Page/inline panel reveal | Frozen short reveal; no text displacement, state changes immediately | style.css:1444 | OFF no animation; EXT same |
| Text links and semantic focus/current | Static underline/brackets/focus/current feedback | style.css:1590–1680 | Kept in all modes; no animated redraw in OFF |

OFF disables both controller decoration and CSS animations/transitions (including underline growth and redraw/reveal/scanning); static focus/current/hover/pressed/status styling remains. BASE/EXT do not use the frozen infinite scanning animation: pending is an explicit static label/icon. This keeps idle animation zero without suppressing real pending state.

Deliberate adaptations: scroll cancels only divider effects, not send/control effects (frozen L947 cancels all; FE-02 send scrolls to latest); component lifecycle replaces body-wide MutationObserver (L954). Each Svelte component owns an empty animation-layer container; imperative renderer modifies only that container, not Svelte children or the textarea. One seeded RNG covers plan selection, identity direction, divider start/direction and yes/no gate; no stray Math.random in measurement paths. Live preferences use natural RNG. Theme/motion choice stored in namespaced, versioned localStorage without content/credentials; effective reduced-motion overrides preference. Unsupported storage falls back in memory.

Tokens are extracted by checking final computed styles of representative frozen elements in both themes, including paper/surface alias inversion and state selectors. Long/truncated/vertical names get freeze overlay alignment checks. Mask rendering includes both mask-image and -webkit-mask-image and is checked on the actual macOS/WebKit version in the report; no unsupported older-OS claim is made. SVG feature failures restore intact sources, not blank controls.

### B3 · A nonempty, honest separator experiment

Correction to R0: `.nav-separator` before Settings is already animated by the frozen probe. BASE must keep it to remain full-coverage; do not remove it merely to manufacture a gain. EXTENDED reuses that **same existing line**, extending eligibility to keyboard focus/press on its adjacent navigation rows (Pending and Settings), alongside proximity. It compares trigger treatment and reading interference, not extra line count. Both paths share the same line record, p=0.25 trial gate, 700ms cooldown and global limit. One contact epoch for a row coalesces focus+press+pointer events; a failed draw is not retried within that epoch. No line is created, and no arbitrary control border is reclassified. The gallery can independently turn label extension and separator-trigger extension on/off for diagnosis, while the required main comparison stays OFF/BASE/EXTENDED. Report label-only and separator-only diagnostic results if the combined result regresses.

Label slice joins the directory item's existing effect record and glyph A/B/C duration; it never starts an independent effect/timer. The link has a stable aria-label containing the full text; temporary display copies are aria-hidden. Hiding the visible source during slicing therefore never removes the accessible name. When narrow layout hides labels, do not construct hidden label slices. Describe this concrete extension to Master with visual samples before adopting it in production.

### B4 · Executable measurement route

Extend study_mode with a separate whitelisted selector `SECRETARY_PHASEUI_SCENARIO=gallery|idle|single|navigation|input-scroll|stream-stress|bridge-cadence`, validated mode `SECRETARY_PHASEUI_MOTION=off|base|extended`, and bounded numeric seed. These do not imply the FE-00 study boolean; main.ts selects a PhaseUI harness explicitly. No selector => ordinary Connected; legacy study remains separate. Invalid values reject the measurement run, never silently use the old study. The harness mounts the production shell/presentation/controller with a deterministic **in-page data adapter**, not the gallery and not a paid/live backend. The benchmark drives the same public state/callback boundaries; action latency here is frontend-only.

`stream-stress` is explicitly synthetic 20Hz/1200 updates and bypasses bridge throttling. A distinct `bridge-cadence` run uses the same deterministic adapter at the source-observed 1.5s durable snapshot/250ms transient cadence and labels itself a cadence simulation, not real network latency. Separate native fixture integration tests exercise the real bridge; their results cannot be inferred from either resource run. All three motion modes use the same ordinary Release binary and only validated mode inputs change. Raw runs go under `.demo-data/issue62/runs/<timestamp>-<scenario>-<mode>/`.

Add per-activation logical-state sampling in instrumented runs: collect frame1/frame2/frame3/resolved computed visibility at rAF checkpoints and report the proportion of **uninterrupted eligible activations** observing every state, plus interrupted activations separately. This is a logical visibility sampling proxy, not physical display proof. Freeze screenshots and separate natural native video/manual inspection complement it. Report sample counts and truncated/invalid activations; a systematic missing middle frame blocks timing acceptance. OFF reports this metric N/A. Keep diagnostic sampling identical in BASE/EXT and quantify overhead with reporting-off controls.

Ordinary Release has no devtools feature. Web Inspector paint/composite evidence is NOT_TESTED on that SHA; if needed, produce a separately hashed diagnostics build and label its data noncomparable to ordinary resource baselines. Registry counters cover controller-owned effects/nodes/timers/listeners only, with deterministic dispose/unsubscribe assertions; do not claim total WebKit listener counts. The harness requires scenario/mode/seed identity, readiness, required samples, completed schedule, queue drain and recovery in its validator; a missing field or truncated run is INVALID/FAIL, never a zero-cost result.

### B5 · Executable native geometry/input matrix

Propose lowering native minWidth from640 to480 logical window units while retaining minHeight480, then measure actual content innerWidth in CSS px. Resize/zoom to achieve 599/600/601,849/850/851,1099/1100/1101 **content CSS px**; outer frame size is not the assertion. Native test window must use the same width constraint. Dedicated PhaseUI diagnostics exposes bounded100/125/150/200% controls using the existing scoped Tauri setZoom permission. Resource measurements fix declared zoom; tests return to100%. Normal product does not acquire new generic IPC or system settings.

Enlarged-text test means a diagnostic typography token override14→18px using the same components, separate from page zoom; label it explicit text-scale simulation, not macOS Larger Text. Evaluate100% and a focused worst-case200% combination. Keep these controls out of normal Settings until #65.

IME adds Cmd+Enter while candidates are open and navigation away during composition (three repetitions each). Guard isComposing/composition state/keyCode229 and actual observed WebKit event ordering. Navigation blurs safely, persists latest committed draft through the existing chain and resets stale composition flags without sending; return restores text/selection where valid. Test candidate confirmation versus a subsequent independent Cmd+Enter so neither false send nor permanent inhibition passes.

CI: pure planner and lifecycle fake-DOM tests run through desktop npm test (using the frozen test approach), plus Rust/API tests; WKWebView suites run locally, as current desktop CI does not launch WDIO. Existing native selectors are updated to the actual conversation scroll owner and explicit navigation to each destination; preserve behavioral assertions rather than merely changing visibility expectations. Before hiding conversation, save its anchor; suppress hidden-page anchor writes and restore after layout on return. This prevents zero-sized hidden bounds from overwriting persisted positions. Existing caches/drafts, request IDs and app identifier remain unchanged.

### Review disposition

Accepted B1/B2/B4/B5 with the concrete definitions above; B3's diagnosis is accepted, but neither removal of BASE coverage nor addition of invented lines is appropriate. The alternative is an explicit trigger-treatment experiment on the existing shared line. Avatars are deliberately included minimally in the real timeline to meet Master's #62 coverage, with full conversation layout deferred. All eleven nonblocking points are incorporated above. The additional Core default-name correction in section9 also requires this revised plan's approval.

## 11. R2 narrow correction and closing notes

Claude R1 accepted B1/B3/B4/B5, the measurement and ownership definitions, and the Core name correction. It left one blocker: distinguish bordered and borderless text-button constructions. Section10 now replaces that row and wording in place. The three-frame effect replaces an existing visible border/underline; it cannot add a rectangle. Bordered buttons suppress the decorative bracket pseudo-elements while their border is reconstructed, restoring them on finish/cancel. Borderless button underline reconstruction uses the existing interaction underline; input/select rendering owns an empty sibling layer in the existing bordered wrapper, never descendants of native form elements. Static focus outline is always retained. No existing line means no invented line: the component must select an appropriate existing visual source and register it in the coverage inventory before claiming coverage.

The six R1 recommendations are also accepted:

1. Put the deterministic fixture adapter behind an injectable BridgePort corresponding to existing snapshot/transient/query/submit/draft/anchor/subscription operations, so Connected/Work/workflow derivations run. Default is the real bridge; only a validated PhaseUI diagnostic selector injects the in-memory adapter, whose implementation cannot forward to Core. Visible synthetic-mode label, isolated in-memory state, consistent synthetic draft/receipt behavior and a test that forbids real IPC in this mode. It still does not prove network/persistence behavior.
2. Production Connected zoom acceptance uses native-test invocation of the existing scoped setZoom API on the connected route with an isolated fixture profile, at100/125/150/200%; real-window manual follow-up can use the same acceptance build. Ordinary Release resource runs remain separate. Thus zoom is not checked only on the harness.
3. When disconnected or lacking a profile, Conversation shows an inline Connection prompt; the dialog opens from that prompt/top utility. Existing attach/start/draft/send test IDs stay on their semantic controls. Do not auto-start or auto-attach a Core.
4. Reject simultaneous legacy study and PhaseUI selectors, including legacy scenario flags; record the conflict as invalid configuration. No silent priority or fallback.
5. The default-name correction also updates docs/api/v1/examples.json and affected API text/localization through existing generators. Explicitly document that non-desktop consumers of the same endpoint see the capitalized blank-name fallback. Explicit configured lowercase names remain unchanged.
6. The deviation ledger explicitly includes replacing the infinite .scanning pending loop with static pending text/icon, as well as connection UI, boundary/underline coverage, scroll cleanup, lifecycle ownership, role avatars, shortcut and separator trigger changes. Master approves these concrete deviations with this plan; final visual acceptance remains later.

Review status: R0 CHANGES_REQUIRED (five groups); R1 CHANGES_REQUIRED (one narrow construction issue, all other groups accepted); R2 submitted for final readiness review. All implementation and new native measurements remain pending Master approval.

## 12. Final review and plan-only verification

2026-10-21: Claude Opus 5.5 Extra returned **PASS** for R2: ready to present to Master; previous accepted conclusions stand. It checked the frozen text-button underline, bordered button and boundary-fault CSS; it ran no tests. Its earlier source/image review and Codex computer-use observations are recorded separately above. Review conversation: https://claude.ai/chat/3de6f59f-0769-44ee-adc9-d32114884c0d . Raw requests/replies and PASS screenshot remain in ignored `.demo-data/issue62/review/`.

Disposition of its two final nonblocking notes: choose the suggested explicit design adaptation of displaying the **same existing underline on keyboard focus/activation** for borderless text-style buttons, so the three-frame line has a visible source; retain the focus outline and record this in the deviation ledger. OFF disables CSS **transitions as well as animations**, leaving instantaneous static states. These choices implement the reviewer's offered options and remain part of Master's plan approval.

Plan-only validation: `npm run docs:check` PASS (610 Markdown files, 8,375 local links, zero errors;119 localization sources/357 pages/638 units current); `git diff --check` and new-file whitespace checks PASS. Repository changes are the two plans and fix index only. Source baseline remained4f1f052. No implementation, new native performance acceptance, paid model execution by Secretary, deployment, PR or merge has occurred. Next action: **Master approves or amends this plan; implementation waits.**


R3 implementation review clarification: primary resource cohorts run without computed-style frame sampling; separate coverage cohorts quantify temporal visibility and reject systematic missing states (below 95% complete eligible effects in single/navigation). Mode order rotates per seed; binary hash is enforced. The input-scroll replay replaces the whole value every 500ms and is labeled accordingly.


Calibration correction: replay follows clock deadlines on the existing measurement rAF loop, at most one scheduled tick per frame. Verify the full fixed tick budget, maximum lateness≤250ms and zero hidden/unfocused active ticks; reject incomplete schedules rather than lowering the100-action gate. Reporting-off idle retains no rAF loop.
