# FE-00 Mac spike evidence

Status: **GO_PENDING_MAC_TESTS**, implementation review in progress. Master authorized Mac-only work for this and subsequent frontend issues; Linux NOT_TESTED is outside the frontend gate. Core Linux CI remains unchanged. Synthetic fixture only; no Core integration or real user data.

## Current candidate

Tauri 2.12.4 / Svelte 5.57.2 / Vite 8.3.4 with locked dependencies. Separate ordinary Release and native-test bundles. Default capabilities restrict commands to zoom and bounded study telemetry. No production npm advisories; development WDIO dependency advisories remain disclosed.

PERRI B1/B2 repairs freeze the selected streaming projection while receiving continues, and make the minimum window usable at 150/200% zoom with persistent composer feedback. Current native evidence is from the working tree based on `2f10d92` with those repairs; its dirty-source flag is explicit. It is not evidence of a clean final release.

| Check | Current evidence | Remaining scope |
| --- | --- | --- |
| Type check / logic | 0 errors/warnings / 5 PASS | Final candidate check pending |
| WKWebView native | 13 PASS | Includes 5-second stream Range preservation/catchup and minimum-window layout; physical clipboard separate |
| Real system Pinyin | 21 steps on `8d5f905` | Latest shared key/pointer guard needs real-path revalidation |
| Ordinary Release security | PASS on `2f10d92` | Refresh after final build |
| Core | Local 616 PASS, 41 DB-dependent skips | Final PR CI verification pending |
| Performance | New `2f10d92` stream completed 1,200 updates at 61.26s plus 30s recovery | Final code comparisons and summary pending |
| Physical cross-viewport copy, system reduced motion, full window matrix | NOT_TESTED | Actual system operations required |
| Hermes / PERRI / Master visual | In progress | No MERGE_READY or MAC_GO |

## Failure history and boundaries

- Initial build needed a bundle icon; WDIO 10 conflicted with service WDIO 9; both corrected without suppressed errors.
- Prepend moved a parent-offset Range; restore original node boundaries. Single-click retention and keyboard selection were separately fixed.
- Real IME exposed an event dispatched after compositionend whose original timestamp preceded it. Independent gestures now require a strictly later event timestamp; equality preserves the guard. Primary left button only. No text classification or fixed timeout. AX activation without a pointer/key origin conservatively requires a second explicit activation; VoiceOver is not verified.
- Embedded WebDriver Enter does not implement button default activation; the regression explicitly uses synthetic key+click. Real keyboard activation evidence is separate.
- Earlier fixed-90-second streaming runs did not finish their 1,200 updates. Their last 30 seconds are **not recovery evidence**. The new harness waits for actual completion and drain; final comparison is pending.
- Initial idle frame sampling was removed. Candidate WebKit process attribution is not proof of exclusive ownership; summed RSS can double-count shared pages.

[Native index](index.json) binds artifacts and hashes to their run. [IME matrix](ime-matrix.json), [raw IME events](ime-events.json), and [first pointer failure](ime-pointer-first-failure.json) retain the actual source/run boundaries. The native Range test is not physical drag/copy acceptance. System reduced motion and Master visual approval cannot be supplied by synthetic tests.

Raw logs/runs remain in Git-ignored `.demo-data/issue58-review/` and `.demo-data/issue58/runs/`. Pending gates prevent merge and #59 progression.
