# FE-00 Mac spike evidence

Status: **MAC_GO — technical feasibility only**, following Master’s 2026-10-20 acceptance. This is not production visual approval or merge authorization. Master limited this and subsequent frontend issues to Mac. Linux desktop is NOT_TESTED and outside the gate; existing Core Linux CI is unchanged. All content is synthetic and no Core service is connected.

## Candidate and verification

Application build: `b49287eaa38ae69c70d99bcfcc9977f4dfae79a7`. Later changes strengthen tests, measurement validation and evidence; application assets/Rust sources are unchanged. [Build provenance](build-provenance.json) records both binary hashes. The native index's source commit denotes the test checkout, not a different application build.

| Check | Result | Actual coverage |
| --- | --- | --- |
| Svelte/TypeScript | PASS, 0 errors/warnings | Frontend and test sources |
| Logic / measurement contract | 5 + 4 PASS | Includes late completion at 170s with only 10s recovery: rejected |
| Native WKWebView | 13 PASS | Clean test checkout `1fb76ab`; same `b49287e` native binary; all four zoom factors at minimum 640×480, longer IME feedback, exact full stream catchup |
| Real system Pinyin | PASS, 28 recorded steps | Seven cases ×3, independent mouse sends ×3, independent keyboard button sends ×3, one correctly blocked queued-key sequence; 15 exact sends |
| Input event → next rAF callback | p50 5 / p95 15 / max 40 ms | 349 events in manual IME run; not end-to-end displayed-pixel latency |
| System reduced motion | PASS | Actual System Settings off→on at frame 2: neutral transforms, same input geometry; restored off |
| Window | PASS within recorded scope | Actual drag/resize, Cmd+M hidden and menu restore, ordinary Release close/reopen; native minimum-size/zoom geometry |
| Short physical copy | PASS | Actual drag, Cmd+C/Cmd+V preserved the first paragraph |
| Full-document system clipboard | PARTIAL | All 468,913 content characters present including final record/10k code; native Selection reference has two extra terminal LF characters; strict comparison remains false |
| Bidirectional 10→900 physical drag selection | PASS, Master reported | Three physical repetitions each direction; no noticeable jump/stall/truncation, selection normal during streaming and prepend. No new clipboard payload/hash supplied; clipboard remains PARTIAL |
| Security | PASS | Ordinary Release: minimal capability/CSP, no embedded driver dependency, no main-process TCP listener; production npm audit zero |
| CI at application commit `b49287e` | PASS | Desktop macOS, Core macOS, Core Linux, Verify; later evidence/harness commit CI recorded on PR |
| Hermes R10/R11 | PASS | Application/measurement tooling accepted; M1 and both public evidence provenance issues closed |
| PERRI | PASS within declared scope | B1/B2/M1 closed; ef95b2b evidence supplement accepted |
| Master visual | Technical feasibility accepted | Animation principle correct; layout, colors and final presentation do not match the demo and are not approved as formal UI |

[Native index](index.json), [minimum-window geometry](minimum-window.json), [stream selection](stream-selection.json), [final IME matrix](ime-final-matrix.json), [final IME events](ime-final-events.json), [system acceptance](system-acceptance.json), [clipboard comparison](clipboard-comparison.json), and [security](security.json) retain methods and boundaries. Physical mouse candidate-panel selection and VoiceOver are not verified. Real-system Shift+Enter was not separately recorded in the 28-step matrix; only unit coverage exists, so that system path remains NOT_TESTED. The accepted independent-click case uses a real Space candidate commit followed by a separate Send click.

## Controlled resource baseline

Ordinary Release on macOS 15.8.2 arm64, AC power, low-power mode off, 1470×956 at 60 Hz, nominal 1180×820 window, zoom 1. Temporary `caffeinate` scoped to the harness app; no persistent setting. Serial runs without UI automation, recording or builds. Instrumented reports show visible/focused window. The reporting-off control cannot report visibility; launch conditions are otherwise the same. Thermal state unavailable.

Startup first-in-run: see [raw metadata](measurements/startup/index.json); ten warm launches median **0.406 s**. This is spawn-to-ready marker, not cold-boot or first-ever startup.

CPU below is the mean **app plus newly appeared WebKit candidates**, with 100% = one logical CPU. Candidate attribution is not exclusive; existing shared processes are reported separately in [raw samples and summary](measurements/summary.json). RSS is a sum and may double-count shared memory.

| Scenario | CPU mean | RSS mean / maximum (MiB) | Timing |
| --- | ---: | ---: | --- |
| Idle after 30s settle | 0.39% | 215.60 / 215.64 | 60s sample |
| Idle reporting/rAF off | 0.13% | 215.00 / 215.05 | Input bookkeeping and periodic callback remain |
| Recycling stream, active | 38.23% | 249.25 / 272.44 | 1,200 updates completed at 61.21s |
| Recycling recovery | 0.97% | 272.20 / 272.44 | 30.76s after completion/drain |
| Full DOM + content-visibility, active | 51.28% | 299.13 / 334.44 | Completed at 61.38s |
| Full DOM recovery | 1.22% | 334.32 / 334.52 | 30.27s after completion/drain |

rAF intervals: recycling p50/p95/max **17/29/40 ms**, full DOM **17/32/44 ms**. Update-to-Svelte-tick max 2 ms / 1 ms. Both ended with running=false, 1,200 updates and queue=0. These runs leave the reading position at its initial top while the growing message is appended below; they measure receipt, parsing, DOM updates and frame callbacks, not continuous bottom-follow scrolling. The final message remains in memory, so recovery RSS is not expected to equal the initial idle value; a single run does not establish absence of long-term leaks.

The comparison supports retaining recycling as the next-stage candidate under these conditions. It is not a universal framework performance claim or a substitute for the physical selection gate.

## Failure history and review corrections

- Initial build required an icon; WDIO 10 conflicted with the service's WDIO 9. Both corrected without suppressions.
- Prepending changed container-offset Range boundaries. Restore original nodes; separate single-click recycling and keyboard selection checks cover retention release.
- Real IME exposed pointerdown whose original event timestamp preceded compositionend despite later dispatch. Guards now require a strictly later original pointer/key event, retain protection at equality, and accept only primary left-button pointerdown. No fixed timeout or text-classification heuristic. Earlier [8d matrix](ime-matrix.json) remains historical and is not reused as the final guard's result.
- A queued Space/Tab/Return sequence in the final run was correctly blocked because its event originated before compositionend; subsequent explicitly independent keyboard activations passed three times. No failed sample was erased.
- PERRI B1: freeze selected stream projection while receipt continues. Native test now checks exact rendered catchup after growth stops. B2: single column below 600 CSS px, reachable navigation/input and composer status. All 1/1.25/1.5/2 zoom cases at minimum size pass.
- Old fixed-90-second stream runs stopped before 1,200 updates; their tail is not recovery. M1 additionally found the total 180s cutoff could leave a short recovery after late completion. The corrected contract rejects missing/late completion and recovery <30s; [independent audit](measurements/recovery-audit.json) validates the preserved final raw runs without rewriting their original metadata.
- Ordinary Release excludes the native driver. Development WDIO transitive advisories remain; production zero is not a claim that development tooling is advisory-free.

Raw runs/logs remain under Git-ignored `.demo-data/issue58/runs/` and `.demo-data/issue58-review/`; source run IDs and hashes are retained. Master’s [acceptance record](master-acceptance.json) closes the observed physical-drag and technical-visual gates. The two terminal LF clipboard difference remains disclosed, with strict equality false; no new exact-copy claim is made. Formal UI must align with `secretary-phase-ui-design`. Record an explicit jump-to-latest-message button as the preferred follow-up; sending currently does not automatically scroll to latest. Neither improvement is implemented in this spike. Final review/CI of this acceptance update is tracked on PR #68. Merge still requires Master’s separate authorization.
