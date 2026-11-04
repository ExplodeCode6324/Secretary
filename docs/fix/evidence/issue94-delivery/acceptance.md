# Issue #94 acceptance ledger

This ledger separates planned checks from executed evidence. No implementation, runtime acceptance or paid model run is authorized by this planning document.

## Planning baseline

- Main: `578bcc2e9d70726e305ededc4e0fa1a68bef3623`.
- Pi TUI dependency: `0.87.0`.
- Observed planning host: Node `v22.22.0`; macOS `15.8.2`, build `24H225`.
- Actual acceptance SHA, Terminal version/font/dimensions/key bytes: NOT_REGISTERED.
- Real provider/model/vision profile: NOT_VERIFIED. Do not infer readiness from a previous text-only run.
- Master implementation approval: NOT_GRANTED.

Predecessor evidence: [#83 acceptance](../issue83-task-browser/acceptance.md) records A6/L2 real Shared cwd/file separation and expressly leaves artifact listing/current-file opening to #94. [#81 implementation evidence](../issue81-attachments/implementation-review.md) distinguishes installed-adapter/loopback coverage from real-provider recognition, which remained NOT_TESTED there. Neither predecessor establishes #94 native image paste or current-file opening.

## Gates

| ID | Requirement | Status | Required evidence |
| --- | --- | --- | --- |
| A | Bound model descriptions and final Main reply artifact tail | NOT_TESTED | IDs, event/call association, rendering, pagination and recovery |
| B / AC22 | Current file, same names, Chinese/spaces and case | NOT_TESTED | Native Terminal, source roots, absolute/relative opens, modified current content versus unchanged CAS |
| B / AC23 | Deleted file and opener failure | NOT_TESTED | One local error, expiry after 5 seconds, working next command, no history mutation |
| C / AC33 | Shared independent directories and registered-only delivery | NOT_TESTED | Two real Shared Tasks, separate report.txt, retained intermediate/workspace, #83 evidence linkage |
| D / AC32 | Direct native clipboard image into actual vision request | NOT_TESTED | Gesture, import completion, ordered attachment IDs, actual provider image-block digest and response |
| E / AC32 | Import failure and business-send failure preserve all materials | NOT_TESTED | Before/after draft, failed versus ready states, original uncertain request identity, one accepted Input |
| F / AC24/31 | Command/page/matter/key scopes and quiet history | NOT_TESTED | Mixed-case commands, Task/matter rejection, explicit send, completion/undo and timeline comparison |
| G | Real Main and Task model integration review | NOT_TESTED | Bounded isolated live run, first failures and reruns, correlated model/tool/result records |
| H | Focused/full checks and exact-head CI | NOT_TESTED | Full verify and Linux/macOS/aggregate CI on implementation HEAD |
| I | Same-session Claude implementation review | NOT_TESTED | Exact SHA and evidence reviewed; independent inspection versus supplied execution evidence |
| J | Master final acceptance and separate merge authorization | NOT_GRANTED | Explicit decisions; no automatic issue closure |

## Per-scenario record template

Record tested SHA, environment, timestamp, actual operation, expected/observed result, failure classification, Task/Execution/result/artifact IDs, source_root/current_path/CAS hash, import and message request IDs, attachment IDs/order/hashes, live model call IDs, evidence location and remaining limitations. Keep secrets and private images out of tracked files.

Native execution, live provider execution and deterministic fault fixtures must be labeled separately. A failed first run remains failed even if a subsequent run succeeds. A blocked direct-paste or vision capability remains BLOCKED/NOT_TESTED until Master selects a remedy and the actual chain passes.

Raw evidence belongs under ignored `.demo-data/issue94/acceptance/`. Task workspaces are not cleanup targets. All caps and controls are specified by the approved plan, not expanded by this ledger.


## R2 additions to planned coverage (not executed)

- Unchanged main.message identity through summary/settings, atomic ID-only main.delivery, normal/truncated/empty final replies, crash/replay without duplicate delivery.
- Per-message artifact pagination and 4 MiB cache accounting; exact Core relative-path filter; legacy dot paths and Unicode collisions.
- Native no-launch checks for run.command and executable-bit files; allowlisted document suffixes only.
- Actual Finder file references rejected, Preview image pixels accepted, pasteboard-change race/probe failure and SSH guard; record OS permission prompts.
- Definite synchronous attachment-admission errors release pending while preserving materials; uncertain transport retains exact identity. Image-only drafts cannot be overwritten by text-only emptiness checks.
- LocalState v3 backup/migration, legacy export refusal with image references, referenced staging-file retention, completion/attachment focus and whole-command paste.
- Existing Main/Task registry reports image input but real provider/profile remains unverified. Approval must cover isolated profile preparation from defensible provider evidence; absence remains a blocker to live acceptance.


Plan review: Claude Opus 5.5 Extra returned PASS_PLAN_ONLY at R4; this is not implementation acceptance. Runtime gates above stay NOT_TESTED. For the known persisted-length crash, run the same scenario on the untouched baseline and candidate, compare observed recovery outcomes, and do not force a predicted status; repeated /resume must not duplicate an already-persisted delivery. Master implementation approval remains NOT_GRANTED.
