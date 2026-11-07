# Issue #106 implementation review dispositions

Review uses the same Claude Opus 5.5 Extra conversation as the approved plan. The raw requests, responses and screenshots are retained privately under `.demo-data/issue106/review/`. Final exact-head review and CI results are appended to PR #110 after code freeze.

## Implementation R1

Claude inspected the PR at `bcc56c6ebc53e53bd8f6fcfbeceb00e496cd634b` against `cfc3ca6efd86137956a730a3986dfacfef5bfba4`. It reported reading the changed source and tests. Its attempt to run tests was denied by its environment, so all execution results remain Codex evidence, not independent reviewer execution. Verdict: **CHANGES_REQUIRED**.

- **B1:** Unified pending/accepted draft identity around raw content plus the original rich snapshot/provenance, independent of generation. Editing then undoing, a late settlement, or undoing an accepted clear cannot produce a second request. Explicit retry and late acceptance tests assert exactly one Guidance and one informational Main Input. Different content remains a new submission. Old tests that simulated new content by incrementing generation alone now actually change content.
- **B2:** Guarded expanded-text inspection on Shift+Enter. A damaged paste snapshot reaches `parseDraft` and remains in the editor with an error. Main and Task regression cases exercise the open-picker branch.
- **G1:** Added a throwaway actual Core server restart test with the product TUI already open, persisted ACTIVE phase older than 30 minutes and below handoff reserve. It reconnects automatically and a guide progresses past SENT without another handshake. The live server and test share the lifecycle owner. Remembered rules, World readiness, identity-bound shutdown and separate Master/rehearsal roots remain explicitly live-harness evidence rather than newly claimed unit tests.
- **G2:** Invalid guide help now gives an ASCII quoted-title example, half-width space and non-zero-leading round instructions, and explicitly says a newline cannot directly follow the round. Smart-quote and U+3000 separator cases are covered.

## Other R1 notes

1. F6 preserves the Task follow target, temporarily disables panel auto-follow and restores the prior scroll-follow state on Esc. Panel scrolling does not modify underlying follow state; the product TUI test checks return behavior.
2. Receipt read failures retain cached receipt metadata and no longer block message reads; a fault-injected refresh test verifies this.
3. A failed durable release restores the prior pending status. A disk-failure test verifies later reconciliation can release it.
4. The panel labels invalid actions unavailable and refuses their dispatch.
5. **Conservative rollback retained:** legacy export still refuses any guidance-bearing state, including the accepted tombstone. Automatically dropping that record would discard the original submission binding and undo/duplicate protection. This matches the approved fail-closed v4 downgrade boundary; exporting evidence and using a separate older-client state remains the explicit recovery path.
6. An unfinished quoted title with an ambiguous suffix suppresses completion instead of replacing the suffix. A completion regression verifies preservation.
7. Acceptance PostgreSQL now listens only on its owned mode-700 Unix socket directory, with TCP disabled. Existing isolated data and ledger are retained; stop/start and `SHOW listen_addresses` were checked.
8. Exhausted connect reports budget exhaustion. An active session whose prepared scenario was consumed reports `SESSION_ACTIVE_SCENARIO_CONSUMED` rather than suggesting initial readiness failed.
9. **Bounded polling retained:** one local latest-Guidance read per status tick preserves revision visibility outside recent-three browsing. Stopping after GUIDED would miss later conflict/disposition revisions. A server event keyed revision cache can optimize this separately; no unbounded history polling was added.
10. Grammar coverage includes smart quotes and full-width separators.

## Additional audit hardening

Late tool proposals are charged durably even if the response arrives after the budget deadline. Corrupt ledger phase/clock/counter/limit combinations fail closed. Launcher status/stop reuse `attachCore` ownership, permission and loopback checks before sending the endpoint token. The persistent manual clock and shared budget survive all candidate restarts without new model calls.

Native Terminal/IME acceptance and Master G106-01–08 remain **PENDING**. Implementation review is not merge permission or issue-closure permission.

The full-suite run on `cf6d38b7` exposed a race in the restart test: after writing the gate file, the automatic pump could already complete the execution before the test called `ready()` again. That redundant test-only transition was removed; the test now relies exclusively on the restarted pump to discover readiness and reach GUIDED. The focused test passed. The interrupted full run is retained separately; a fresh final full run and CI are required on the subsequent head.
