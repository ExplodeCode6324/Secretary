# Issue #82 implementation evidence

Status: implemented and locally validated; no product review PASS, PR CI or merge is claimed by this record. The R7 plan was approved at `bff4f6f759b3a4012134f8317451c898329d5307`; its delivery record is `c55515809810c1fae982a4618c25098a8f7e6c7a`. Coordinator release authorized implementation after that plan review. Historical plan bodies and G0 failures remain unchanged.

## Implemented boundary

The product is a local browser-hosted command interface using plain DOM, Node HTTP and exact `ws@8.21.3`. Its sole Python writer owns `tui-v1/`; Core lifecycle and storage remain independent. Input nodes retain typed/paste provenance. Durable outbox replay uses original ID/bytes, explicit reconnect Resume, binding checks and a post-fsync generation check. Main uses bounded API/SSE state with separate derived checkpoints. See the [user guide](../../../tui/browser-guide.md) and [API inventory](../../../tui/api-coverage.md).

## Evidence collected so far

- First focused run: 26 tests passed across editor, typed HTTP client, writer, outbox, browser channel and SSE/cold-start recovery.
- Real fixture Core integration passed: control-bearing text was received exactly once after an intentionally lost acknowledgement and same-ID/same-byte replay; one timeline row remained; client shutdown left Core attachable. This uses the actual Core API with a fixture model, not a real provider.
- A 30-second burst test emitted 6000 sync transactions with 20 ms injected per fsync, concurrent typing/draft saves and sends. Draft and attempt ACK bounds passed, as did the one-slot checkpoint bound. Its input timing measures Node model publication, **not native browser paint or IME**; raw metrics remain in ignored evidence.
- Chrome 155 on macOS: browser-delivered typing, Ctrl+S, command buffer and explicit `/quit` were exercised against an isolated HTTP fixture. One `hello` request reached the fixture and became a visible timeline row. This is UI/transport evidence, not real-provider acceptance.
- Browser-tool paste/Meta+V delivered `paste` with `isTrusted:false`; the product rejected it and preserved the draft. The instrumented fixture retained the event trace. This proves synthetic-event rejection only; native clipboard delivery is NOT_TESTED here.

Initial type-check failures (unsupported target String method and two state typing issues), the first fixture import-path failure, original logs, sources, metrics and screenshots are preserved under Git-ignored `.demo-data/issue82-tui/implementation/`. No first failure was replaced with a later pass log.

- Additional real Core product tests passed for local Task routing, two-step `/send` replacement/cancel, explicit non-undoable large paste removal, and foreign-endpoint mutation/cleanup quarantine. The first product-fixture attempt failed because its test launcher did not publish `core-endpoint.json`; the original log/source were retained and the fixture was corrected, without changing attach-only behavior.
- Chrome 155 explicit Copy/Cut/Undo and reload restored the canonical draft, with clipboard text read back. A separate actual duplicate-tab test copied sessionStorage through a fixture opener: the new generation revoked the old tab, whose seven unacknowledged `UNSAVED` insert events remained visible and explicitly copyable. Two durable entries produced zero HTTP requests before Resume; the new tab's Resume then sent exactly those two bodies in FIFO order. The fixture injected a one-second handler delay to expose the takeover race; it did not simulate the browser's sessionStorage copy.
- Actual adapter source was run with a simulated DOM/channel to test exact physical-code/modifier/repeat rules, composition precedence, source-preserving control paste/drop, untrusted-event rejection and retained disconnected composition. These are routing tests, not native OS input evidence.
- Additional writer tests cover paged receipt metadata, leap-year calendar expiry, disk-full staging preservation and parent SIGKILL during a delayed helper write.
- The initial complete `npm run verify` finished with **765 tests: 723 passed, 42 PostgreSQL-dependent skipped, 0 failed** in 702.7 seconds. Later focused checks passed after the additional fixes above. A final frozen-source run with an issue-owned PostgreSQL instance follows; the initial skipped run is not reported as PostgreSQL verification.
- The first burst metrics were: 6000 transactions; 79 draft saves, maximum ACK 298.94 ms; 26 attempt markers, maximum ACK 197.33 ms; Node model-publication p95 0.55 ms/max 1.10 ms; checkpoint pending slot maximum 1. Native/browser paint remains NOT_TESTED in that measurement.

- The frozen-source PostgreSQL-enabled `npm run verify` passed **773/773 tests, 0 failed, 0 skipped**, in 858.44 seconds. The issue-owned PostgreSQL cluster was isolated on loopback; its source hashes, full diff and original log were retained. This run used Node 22.22.0 and the system Python 3.9.6.
- A subsequent unsupported-browser probe reproduced an initialization exception when `Intl.Segmenter` was missing. The first failure is preserved. The adapter now renders read-only text without that API and disables input; the editor's boundary calculation now retains numeric offsets without retaining an intermediate array of segment objects. A formatting-only correction followed the preserved first format-check failure. The final focused editor/adapter/real-Core integration run passed 10/10; type, format and documentation/localization checks passed. Exact-HEAD CI/review remain separate.

- Post-submit Unicode audit found that inserting a base character before a standalone combining mark left the caret inside the newly joined grapheme. The first reproducer is preserved. Edit/collapse now snap selection to a valid full-draft grapheme boundary outside collapsed paste interiors; undo/redo and recovery preserve both text and provenance. The focused editor/adapter/Core/burst run passed 12/12.
- Initial PR macOS CI failed the burst test's minimum attempt-sample count (`>= 20`); Linux was still running. The first job log is retained. Numeric metrics are now printed before assertions so subsequent CI failures retain all measurements; no bound or sample requirement was weakened. CI and reviewer disposition are pending.

## Remaining gates

Required Linux/macOS CI, same-Claude exact product HEAD review and coordinator's separate exact-HEAD merge decision. Native OS IME, native clipboard/shortcut behavior and final visual acceptance remain explicitly NOT_TESTED unless a genuine corresponding run is recorded. Master's environmental deferral policy does not waive functional defects or turn fixture/CDP evidence into native evidence.
