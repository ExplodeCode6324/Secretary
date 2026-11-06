# #104 implementation evidence / 实施证据

Master approved implementation after the bilingual R2 plan PASS and requested real-model testing. Merge and issue closure still require separate authorization.

## Implemented behavior / 实现结果

- Task streams are drained into bounded disposable per-Store previews; Agent receives only the persisted done response. Main and Task caches and SSE budgets are independent. Token updates create no journal facts, Guidance adoption, Main Input or model calls.
- Proven assistant responses use `call:<ModelCall.id>`, with original event-ID aliases. An atomic per-call `model.task_preview` marker distinguishes new display-capable calls from legacy history. Legacy completed calls retain their original event rows; no heuristic duplicate removal. Saved responses remain readable before Agent handoff and after restart. Synthetic failure messages retain separate event IDs.
- Incremental execution indices support `position=latest` without scanning execution history per delta. Task content accepts `position=latest` for a 32,768 UTF-16 tail with explicit offsets/lengths; a missing Markdown prefix is labeled as a formatting-context boundary and rendered literally. Normal cursor reading remains available.
- `/follow`, `/follow <execution_id>` and `/follow off` are Task ordinary-detail commands. The exact AGENT execution is frozen at submission, displayed in the header and preserved across valid reconnect/resize/CoT refresh. Reading/navigation stops it. Terminal state displays the final tail before stopping. Delta refreshes read the affected body, not the root list or all 50 messages.
- Authorization WAIT_AUTH and its Task outbox fact commit together. Delivery rechecks pending/unexpired authorization, WAIT_AUTH Operation and live/non-cancel-requested Execution; it does not require Execution WAIT_AUTH. Obsolete notifications settle SUPPRESSED without Input. Feedback transitions are enforced and suppression is settled for retention. Ordinary decisions/results and the single UNKNOWN execution episode have stable dedupe, including legacy facts.

## First failures / 首次失败

All raw evidence remains Git-ignored under `.demo-data/issue104/`.

1. The first long-history test manufactured an invalid terminal Execution without result/time; changed it to exercise the real scheduler cancellation path.
2. Legacy pagination expected assistant event IDs; now maps only proven causal responses to their canonical call IDs while retaining contiguous-order assertions. A dedicated legacy-call test prevents duplicate fallback rows.
3. A historical crash-gap test expected zero Feedback after decision persistence. The new atomic producer correctly has one; the test now checks same-frame creation and recovery delivery. The state-catalog test was extended only after Feedback transition enforcement was added.
4. Real-model attempt 1 reached HTTP 200 but exposed an encoded-colon routing failure (`MESSAGE_NOT_FOUND`). Fixed segment decoding and added encoded canonical-ID HTTP/body assertions.
5. Real-model attempt 2 showed 25 live snapshots, zero Main calls, and honest terminal FAILED after DeepSeek exhausted the existing 4,096 output budget (reasoning included). The response was durably marked `length`; no budget was raised. The acceptance assignment was reduced from 40 to 12 sentences, preserving the before-save observation, marker and structured-result requirements.

## Real provider / 真实模型

DeepSeek `deepseek-flash`, isolated test root, existing credential loaded without printing it, exact provider destination, at most three physical calls per run and six tools. Main is disabled; no product service or production data is used. The third attempt passed with **one physical call**, **19 pre-save snapshots**, **zero Main calls**, matching stable message identity, final markers and **SUCCEEDED**. First observed preview: `2026-11-06T14:02:00.813Z`; response saved: `2026-11-06T14:02:02.726Z`. Raw request hashes, sample hashes and saved-response hashes are retained. Final-source confirmation is recorded separately in the PR closeout evidence.

## Native boundary / 原生验收边界

**NOT_TESTED**: native macOS Terminal wheel/drag/copy, resize, reconnect and final rendering. Computer Use rejected access with: `Computer Use is not allowed to use the app 'com.apple.Terminal' for safety reasons.` The prepared isolated 126-message native fixture was stopped; no substitute browser was used. VirtualTerminal/component tests and real-provider HTTP/SSE evidence do not establish native acceptance or Master's product acceptance.

## Verification / 验证

Targeted suites currently pass: 20/20 (new streaming/follow/feedback cases plus decision crash regression), then 17/17 after adding saved-replay/legacy and enforced Feedback transitions. Source/doc/type checks, full isolated PostgreSQL `npm run verify`, hosted Linux/macOS CI and Claude exact-HEAD review are tracked independently; final immutable results will be added to the PR after the code is frozen. A failing partial/full run is never a passing result.

Frozen-source confirmation: `live-freeze.log` PASS, **2 physical DeepSeek calls**, **16 pre-save snapshots**, **0 Main calls**, SUCCEEDED. First preview `2026-11-06T14:13:08.120Z`; last response saved `2026-11-06T14:13:11.633Z`. The 11 dedicated #104 tests passed on this source. Task SSE membership also obeys current owner/browsability/recent-three checks through cached Task metadata; Task ModelCall changes invalidate the execution message window rather than Main history. The first full verification was stopped after preserving two stale-expectation failures; a new complete PostgreSQL run is executing on the frozen source.
