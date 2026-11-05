# Issue #94 acceptance ledger

This ledger separates planned checks from executed evidence. Master subsequently authorized implementation, PR/CI and an isolated manual instance on 2026-11-05; merge remains separate.

## Planning baseline

- Main: `578bcc2e9d70726e305ededc4e0fa1a68bef3623`.
- Pi TUI dependency: `0.87.0`.
- Observed planning host: Node `v22.22.0`; macOS `15.8.2`, build `24H225`.
- Actual acceptance SHA, Terminal version/font/dimensions/key bytes: NOT_REGISTERED.
- Real provider/model/vision profile: NOT_VERIFIED. Do not infer readiness from a previous text-only run.
- Master implementation approval: GRANTED on 2026-11-05; PR, CI and isolated manual instance requested.

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


Plan review: Claude Opus 5.5 Extra returned PASS_PLAN_ONLY at R4; this is not implementation acceptance. Runtime gates above stay NOT_TESTED. For the known persisted-length crash, run the same scenario on the untouched baseline and candidate, compare observed recovery outcomes, and do not force a predicted status; repeated /resume must not duplicate an already-persisted delivery. Master implementation approval GRANTED on 2026-11-05.

## Implementation observations (in progress, 2026-11-05 HKT)

- Candidate deterministic tests: registration/path binding, ID-only atomic sidecar, 32-item pagination below 128 KiB, empty truncated reply, current-file disappearance versus available CAS, ownership, literal local commands, executable/link refusal, probe file-reference/race handling, v3 migration, complete material restoration, and actual Core import/send response-loss recovery have passed focused runs. Full suite is running; first failures are retained in ignored implementation logs.
- Eight abrupt-process-exit scenarios passed, covering before/after message commit, stop/length and with/without artifacts. The after-commit scenarios were also executed against untouched base 578bcc2e9d70726e305ededc4e0fa1a68bef3623. Recovery state/Input states match the baseline, and repeated resume never adds a second delivery. No general recovery policy change.
- Live run A: real Main created exactly two Shared tasks and one DIRECTORY task. All three gpt-5.6-luna Task requests failed on their first provider call with HTTP 403 unsupported_country_region_territory; no files/registered artifacts. These are FAILED, not acceptance passes. Master was asked before changing the Task model; budget remains shared across attempts.
- Actual vision request PASS with synthetic capture: existing Main deepseek-v4.1-flash recognized a green circle and the fresh code V44999, which was absent from the text prompt. The existing TUI import/outbox code sent attachment eeed5ce4-fc0b-45c0-b02a-c3b6943ca287 (import request 3f2c40b6-416b-41aa-b4b2-c0bdeb8774be), then Core Input 6a412b40-a430-43a6-ab2f-27c83658e23c. Actual provider fetch contained PNG SHA256 dfe3e2e0a43c3cc2e0e0bc5b28b827d39e4e49b412d295514d575a696c32ddee, 8733 bytes, exactly matching imported bytes. Capture was synthetic; this does not pass the native Ctrl+V gate.
- Isolated vision profile: 1024 tokens/image, 4096 side, 4194304 pixels, exact opencode-go / openai-completions / deepseek-v4.1-flash / https://opencode.ai/zen/go/v1 identity. The estimate uses the [DeepSeek documented image-token upper bound](https://api-docs.deepseek.com/guides/vision/) and [OpenCode model mapping](https://opencode.ai/v2/docs/console/go/), checked 2026-11-05; it is not installed in production.
- Native automation BLOCKED: the computer-control tool rejected com.apple.Terminal for safety reasons. No Terminal, Finder/Preview copy, direct Ctrl+V or external-viewer content acceptance is claimed. Master must perform those steps on the final isolated instance. The candidate JXA probe has not yet been exercised against native clipboard pixels.
- Image harness first attempt failed locally before any provider send because the acceptance server had not published its endpoint file. The harness now writes mode-0600 core-endpoint.json, and the successful second attempt is retained separately. This was harness calibration, not a product success on the first attempt.

Raw evidence: .demo-data/issue94/implementation/ and live-20261105-a/. Provider usage is cumulative in .demo-data/issue94/provider-usage.json. No secrets or private images are included in tracked evidence.

### Run B — provider decision and first attempt

Master retired OpenCode and authorized up to three replacement proposals (two Shared, one DIRECTORY) on a fresh domain within the original cumulative ledger. A rejected proposal also uses a slot. The direct DeepSeek option was superseded before any DeepSeek API call. Master supplied a dedicated OpenAI credential for this isolated run. Main and Task use `openai / openai-responses / gpt-6-astra / https://api.openai.com/v1`. The acceptance-only vision profile reserves 5226 tokens/image for at most 4096 pixels per side and 4,194,304 pixels total, based on [OpenAI's patch sizes and GPT-6 Astra multiplier](https://developers.openai.com/api/docs/guides/images-vision). Original Run A results remain above.

At commit `05b2f11e`, the loopback Core started and an authenticated client confirmed the new data domain. Its initial Main request and retries failed before receiving HTTP response headers. Independent curl and Node checks also failed during TLS negotiation. At the first recovery boundary the shared ledger contained 28 Main attempts, 3 Task attempts and 6 tools. Run B had zero Task executions, registered artifacts or delivery sidecars. The new PNG imported and its Input was accepted, queued behind the blocked Main loop. Official GPT-6 delivery and vision, and all native Terminal checks, remain open. Raw observations are local to the ignored run B evidence directory.


OpenAI profile source for the archived Run B: the official guide gives GPT-6 Astra 32×32-pixel patches and a 1.2 multiplier. Auto uses original sizing: scale only beyond 65,535 pixels on either side, reject above 30,000 resulting patches. Our local caps give ≤4,353 patches and conservatively 5,226 tokens. Run B received no HTTP headers or provider token usage to compare. Its six Main attempts are the difference between ledger counters 22 and 28. Master switched to the authorized fallback rather than resuming Run B. [OpenAI vision sizing and accounting](https://developers.openai.com/api/docs/guides/images-vision)

### Run C — official DeepSeek result (2026-11-05)

Master authorized an explicit direct fallback. Authenticated model discovery returned HTTP 200 and listed `deepseek-flash`. A fresh isolated domain ran the candidate at `57044eb4` using `deepseek / openai-completions / deepseek-flash / https://api.deepseek.com` for both roles, one shared ledger and the original three replacement slots. The earlier OpenCode and OpenAI failures remain in that ledger. The isolated DeepSeek vision profile uses a conservative 1,024 tokens per image, 4096 pixels per side and 4,194,304 pixels total, as in the [DeepSeek vision guide](https://api-docs.deepseek.com/guides/vision/).

| Scope and content | Execution | Registered relative path |
|---|---|---|
| Shared / ALPHA-19 | `51cfd79a-9d25-4006-9439-6405960d4681` | `report.txt` |
| Shared / ALPHA-CHINESE-23 | `51cfd79a-9d25-4006-9439-6405960d4681` | `中文 目录/Report.txt` |
| Shared / BRAVO-27 | `a0ad4f4c-0f16-45e5-9863-44c9c391b4a9` | `report.txt` |
| DIRECTORY / CHARLIE-33 | `081aca18-cfd8-40ca-be5e-b0a1c0ef7dff` | `report.txt` |

All three TaskResults were SUCCEEDED. An authenticated CoreClient verified four different registered IDs, four individually explained files with NOT_VERIFIED provenance, exact current bytes and identical immutable CAS bytes, case-sensitive path and execution filtering, three claimed-result delivery sidecars pointing to the actual final messages, and two retained, unregistered scratch files. The three `report.txt` current paths are distinct. Task A requested `pwd; ls -la` in its isolated working directory despite the no-shell prompt. Master approved only that read-only operation, and Core recorded the approval as consumed. The original Task A then finished; no new proposal, persistent rule, or extra task was needed.

The synthetic PNG reached DeepSeek as an image and the reply identified a green circle and read the fresh code **V75136**. The staged image, imported Input and outgoing provider image all have SHA256 `166f4cd09659f5d250a668601b9eeccedf212a4cfe6d7d161bb622aeca44206b`. Actual native macOS clipboard capture, viewer selection, file modification/deletion behavior in the external viewer, terminal input handling and visual paging still require Master's manual acceptance. The handoff instance stayed running. Immediately after this automated chain the cumulative counters were 40/48 Main, 14/32 Task, 27/160 tools, and 516.356/1500 active seconds. These are shared totals across all three domains.
