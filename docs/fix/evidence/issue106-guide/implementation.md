# Issue #106 implementation evidence

Master approved the R4 bilingual plan on 2026-11-07. This record distinguishes product tests, real-model evidence, native evidence and Master's final acceptance. PR review and CI are recorded against the final commit in the PR conversation.

## Product changes

- `/guide <exact title> <permanent round> <body>` is restricted to ordinary Task input with a typed leading slash. The body is preserved after existing editor ingestion, including multiple paste blocks; title/round completion splices only its token.
- A v4 private local outbox freezes task/execution IDs, path, request UUID, full body, hash and original rich draft before dispatch. Main delivery remains independent. Reconnect only reads. Explicit retry uses the original request; authoritative terminal/nonacceptance proofs or a preserved conflict export release the slot. An accepted receipt awaiting a detail read cannot resend.
- F6 exposes receipts and explicit retry/copy/restore/conflict actions. Current MASTER and MAIN receipt metadata sits outside paged historical messages, with no duplicate full body. Old pages are reread to obtain revised dispositions. Latest local submission remains inspectable outside recent-three browsing.
- An isolated acceptance launcher owns its socket-only PostgreSQL cluster, World projection, Core, data, state roots, shared atomic budget and phase/deadline. ACTIVE restart resumes pumping without another handshake. ARMED leaves the service queryable until Master's first explicit connect.

## Automated evidence

The issue106 tests cover grammar/UTF-8 boundaries, typed/pasted provenance, real paced editor completion and multiline suffix preservation; actual HTTP receipt binding; response loss then target end; negative proof after a never-arrived request; accepted-detail read failures; disk failures including concurrent editing during failed final fsync; conflict/integrity preservation; locked state, migration and corruption; immutable target capture and cached monotone limits; product TerminalApp HTTP/SSE guidance and F6; receipt paging and older-revision refresh; persistent budget/reconnect/wall-clock behavior, including late-response proposal accounting and an actual Core restart with an already-open product TUI progressing past SENT without another connect handshake.

A first related regression group passed **169 tests** across issues 91, 94, 104, 105 and 106. The final expanded issue106 suite and full isolated-PostgreSQL verification are reported in the PR after completion. The first TUI test exposed a missing alternate-document update on F6; the fix is verified. A pagination fixture initially attempted an invalid Guidance mutation; it now uses a durable Main tool response for MAIN-source coverage. The first full regression run also found an expected-command-list assertion still missing the newly added `/guide`; that assertion is updated while retaining scope checks. These test setup failures are retained in private logs, not treated as product acceptance.

## Real provider evidence (2026-11-07)

Both Main and Task use `deepseek-flash` through the production `roleModel` adapter, actual HTTPS requests and product Core APIs. One checked existing private credential source is used; no key is present in artifacts. PostgreSQL/World is enabled and memory search is ready.

1. Two automated runs submitted a guide during an actual Task provider request, including one with Main deliberately unavailable. Each recorded SENT, RECEIVED, GUIDED, ADOPTED and a successful final result containing `GUIDE106_LIVE`. Controlled HTTP response loss was reconciled after closing/reopening the local outbox; each accepted guide produced exactly one informational Main Input.
2. A separate **product TerminalApp**, attached to the actual live Core via HTTP/SSE with a VirtualTerminal, submitted multiline guidance and observed 59 timed snapshots, including 57 with an unsaved-preview marker while the execution was RUNNING. The resulting summary contains `GUIDE106_TUI`, cites only the permitted orchard evidence and records the obsolete second-file operation being blocked. The raw model/tool evidence is retained for inspection; model adoption alone is not presented as proof of downstream behavior.
3. A fresh DIRECTORY scope with `default_write: ask` produced a genuine pending authorization for a harmless write. It is left waiting for Master, with no short deadline. At initial readiness the shared ledger recorded **31 physical requests / 25 tool proposals**, leaving **69 / 275**. The manual window was unstarted, no provider calls were in flight, and pumping was disabled.

Private evidence lives in `.demo-data/issue106/acceptance/`: `provider.jsonl`, `rehearsal.json`, `tui-rehearsal.json`, `budget.json`, `scenario.json`, status/restart outputs and model/journal objects. The endpoint bearer token and control token remain in private runtime files and must not be copied into review material.

## Boundaries and pending acceptance

Computer Use rejected access to `com.apple.Terminal`; no alternative OS-input route was used. VirtualTerminal demonstrates product integration and rendering but does **not** establish native IME, clipboard, keyboard or daily-use acceptance. Native acceptance and Master G106-01–08 remain **PENDING**. No merge or issue closure is authorized by implementation approval alone.

[Implementation review dispositions](implementation-review.md) · [Prepared handoff instructions](handoff.md) · [Bilingual plan](../../fix_20261107_issue106_guide.en.md) · [Plan review](plan-review.md)
