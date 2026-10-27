# Terminal correction preparation

2026-10-28, Asia/Hong_Kong. Preparation only; product code unchanged.

## Source and baseline

- Fetched main: `e090a9c79f69fc68cb4b81caa392e1b82675cf34`; tracked tree matches original PR head `4bb7dbb6cec7903af8fbbea75dd6f34f5ff1025c`.
- New work branch: `codex/issue82-terminal-rollback`.
- Existing unrelated untracked historical reports retained.
- Focused Issue82 baseline: **76/76 PASS**, zero failures/skips. Groups: editor, outbox, sync, writer, writer-barriers, regressions, responsiveness, performance-policy, G0. First log: `.demo-data/issue82-terminal-rollback/baseline-first.log`.
- Core preservation baseline: **46/46 PASS**, zero failures/skips. Groups: all Issue80 tests, Issue81 input/provider. First log: `.demo-data/issue82-terminal-rollback/core-baseline-first.log`. This is not the complete #81 suite, real-provider testing or terminal acceptance.
- G0 includes an expected-failure witness for split paste end markers. Its test PASS confirms reproduction of the limitation; it is not a safety PASS.
- Existing G0 PTY probe: normal exit, hangup and parent SIGKILL all retained their expected synthetic draft and allowed the writer lock to reopen. The normal run captured ten terminal sizes; the pinned headless renderer processed the captured ANSI successfully. Logs: `g0-pty-first.{json,log}` and `g0-render-first.log` under the same ignored evidence root. This is historical-probe PTY/headless evidence, not the new terminal entry or native IME acceptance.

## Legacy fixtures

Before changing the loader, the unchanged baseline generated six isolated synthetic profiles: PREPARED, ATTEMPTED, UNKNOWN, NEEDS_EDIT, CONFLICT and a mixed-state queue. Each has separate Main/Task drafts, paste provenance, undo/redo state, a view and a reading anchor. Source hashes for state/editor/writer and expected state/editor snapshots plus exact frozen bodies are recorded alongside the fixture.

Generator and first run log: `.demo-data/issue82-terminal-rollback/generate-legacy.ts` and `legacy-generation-first.log`. Original profiles are retained under `legacy-baseline-Y5PIaq/`; compatibility checks must copy them before opening. No live user profile was read or changed. These are preparation fixtures, not results for a modified loader.

A second fixture set, `legacy-baseline-9ugMWD/`, additionally contains durable receipt archives. `check-legacy.ts` verifies each copied profile through two open/save/close cycles, comparing the full client state, both editor snapshots and exact outbox/receipt text. Original source-fixture file hashes are unchanged. All six profiles passed (`legacy-reopen-second.log`). No network transport is constructed; zero POST here is by harness construction, not proof of a product Resume gate. The first check failed with `UNSAFE_STATE_ROOT` because Node's copy operation did not preserve the copied directory's mode. The isolated test copy now explicitly restores mode 0700; the writer's security check and product code are unchanged. The first failure remains in `legacy-reopen-first.log`.

## Test disposition inventory

| Existing coverage | Terminal disposition |
| --- | --- |
| editor, commands, writer/barriers, outbox, sync, client transport, performance policy | Keep assertions; adapt only ownership vocabulary/API when needed |
| core-integration: exact frozen replay and Core survives client close | Keep; add real product-entry lifecycle evidence |
| core-integration: Main/Task, replacement and foreign-domain guards | Replace browser construction with terminal presentation port |
| regressions: ICU, legacy caret, paste provenance, capacity, UNKNOWN retention | Keep |
| regressions: large paste via authenticated socket; expired/repeated large-edit decisions | Move controller assertions to terminal event pipeline; archive socket mechanics separately |
| browser-channel: structured paste cannot dispatch and partial transaction cannot authorize | Keep in input/controller suite |
| browser-channel: Origin, token expiry, duplicate-tab generations | Archive browser-only acceptance; replace product authority assertions with local lease revocation tests |
| browser-adapter: refusal/Resume visibility, clipboard races, pending large-edit decisions | Reimplement equivalent terminal acceptance before removing browser harness from official path |
| browser-adapter: DOM composition/isTrusted, native range rejection, missing browser Segmenter | Historical browser evidence; new native terminal/IME evidence required |
| reconnect-observer | Keep Core/SSE reconnect observations; they do not grant a terminal send lease |
| G0 PTY and failure records | Preserve as historical probe; product PTY must launch actual new entry |

## Native acceptance constraint

The current computer-use tool rejected access to `com.apple.Terminal` with “Computer Use is not allowed to use the app 'com.apple.Terminal' for safety reasons.” No Terminal UI action or test was performed. Do not work around that denial with another UI automation route. Shell-driven PTY tests remain a separate, valid test surface and cannot establish native IME/physical shortcut acceptance. Actual Terminal checks remain NOT_TESTED until an authorized native test route or Master-operated acceptance is available.

## Review

R1 complete English plan submitted to Claude **Opus 5.5 Extra**, verified in the model selector, at 2026-10-28 01:31:34 HKT. Session: https://claude.ai/chat/a9b3db05-d40d-46ff-9ca8-c81e9e62419b . Full text was verified against the saved request ignoring whitespace before sending. Raw request, submission metadata and screenshot are in `.demo-data/issue82-terminal-rollback/claude-r1-*`. First read is due after 01:41:34 HKT per the review skill. No review outcome yet.

The first long-text typing call timed out, leaving an incomplete unsent draft. This was corrected before submission: duplicate unsent paste cards were removed, the complete request was restored and text equality was checked. This is browser-tool preparation history, not a product failure.
