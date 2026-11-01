# Issue #92 acceptance ledger / 验收账本

Date: 2026-11-02. Implementation revised after Claude R1; evidence below is scoped, not Master acceptance.

The original source-freeze snapshot below is `c7fd8b7dc183165386f095299fdddc6993aafe22`. Later exact-head checks and Claude results are recorded in [PR #99](https://github.com/ExplodeCode6324/Secretary/pull/99).

| Gate | Status | Evidence / limitation |
| --- | --- | --- |
| Bilingual plan + Claude review | PASS_PLAN_ONLY | R2 PASS; B1–B6 closed, non-blocking notes adopted; source review only |
| Master implementation approval | APPROVED_WITH_CONDITION | 2026-11-02: failure categories visible; exact disposition/removal stays #93 |
| A1 / AC16 + AC02 | OFFLINE_PASS | Complete projection, ordering, overflow, archive and read-only exception display |
| A2 / AC17 | OFFLINE_PASS | Multiline edit/selection, immutable target, rich drafts |
| A3 / AC18 | OFFLINE_PASS | Directed answer, full authorization/version, APPROVED-before-CONSUMED removal |
| A4 / AC19 + AC24 | OFFLINE_PASS | Task show, command bypass, literal slash answer |
| A5 / AC34 | OFFLINE_PASS / NATIVE_NOT_TESTED | Esc/restoration covered by Pi tests; physical terminal keys remain unverified |
| A6 / AC20 | OFFLINE_PASS | Invalid target, surviving errors, same-ID retry and reconnect |
| A7 / AC28 + AC31 | PARTIAL_PASS | L4 UI-only history/model/retention checks pass; physical IME/keys remain unverified |
| L1/L2 provider + L3 controller + L4 quiet Core | PASS_WITH_SCOPED_LIMITS | Real opencode-go/deepseek-v4.1-flash; L3 transport fault matrix offline; L4 deliberately makes no provider call |
| Focused + PostgreSQL verify | R2_TARGETED_PASS / FULL_PRIOR_HEAD | R2 focused 25/25, check/docs pass; local full verify 882/882 at prior implementation. R2 exact-head full CI follows in PR #99 |
| Exact-head Linux/macOS/aggregate CI | PASS_2045305 / R2_PENDING | Run 41347553529: Linux 881 pass + 1 macOS-only skip, macOS 311/311, aggregate success; R2 head requires fresh CI |
| Claude exact-head implementation review | CHANGES_REQUIRED_R1 | R1 accepted classification; B1 historical read cost and B2 invisible formatting fixed for R2. Same-conversation re-review pending |
| Master native/manual acceptance | NOT_TESTED | Simulated/PTY keys cannot prove physical IME |
| Master merge authorization | NOT_GRANTED | Plan approval is distinct |
| Merge/post-merge CI/issue closure | NOT_DONE | Separate gates |

AC21/AC29 failure disposition/cancellation remain #93; artifact/image operations remain #94. Seeded UNKNOWN and controlled executor pauses must be labelled separately from real-provider unpaused chains. Preserve first failures, private evidence and exact actual object/request IDs; publish only sanitized summaries.

R2 provenance clarifications: >100-volume, nonempty options/materials, deadlines, authorization display changes and foreign-session records are SEEDED or scripted-provider cases; only actual provider-produced request_decision questions and authorization operations count as LIVE_MODEL. An ended-owner PENDING authorization remains legally decidable but cannot resume that execution. Current Delivery draft wins over an entry snapshot. Process restart does not recover or replay a matter request; in-process retries preserve ID. Failed rows are not removed by newer unrelated executions; #93 owns authoritative disposition linkage.

Final review expectations: active Agent authorization rejection may produce FAILED, whose Main failure row persists; existing-domain historical failure rows are expected. Failure redo/disposition removal is NOT_DELIVERED_BY_92 (#93). Seeded domains must use pump:false/no live credentials; physical IME still NOT_TESTED. No implementation or merge approval inferred from plan PASS.

## Implementation evidence in progress

- Related offline regression: 151/151 passed (issue82, issue83, issue91, issue92), before the final targeted reconnect/focus/digest guards. Issue92 subsequently reached 20 passing tests; final full verification pending.
- Real-provider first attempt: Main-origin and Task-origin literal MASTER answers and real Agent resume passed. Harness then used root instead of root_path when creating the scratch Scope and failed INVALID_SCOPE_ROOT. First report retained; no product fix was required. Retry uses a fresh Core directory and carries forward model/tool/time budget usage.
- Raw runtime evidence: ignored `.demo-data/issue92/live-20261102-a/` and `live-20261102-b/`; credentials are never copied into tracked files.
- Native Terminal attempt: UI tool refused access to com.apple.Terminal for safety reasons. No native keyboard/IME success claimed. The separate pump:false fixture service was stopped; no live credentials were used there. Physical acceptance remains NOT_TESTED.
- Initial offline failures were invalid test-fixture Execution transitions, then missing required result/receipt fields; fixtures were corrected to follow the real state machine. No product transition was loosened.

## Runtime result at source freeze

[Sanitized runtime evidence](runtime-summary.json): full real-provider run PASS, followed by final-source answer/reconnect smoke PASS. Cumulative Main 31 / Task 18 calls, 27 tools across three attempts, within the original 20-minute budget (20:12:54–20:23:41 UTC). No source-hash mismatches for the recorded final product files.

- L1: real Main created real Agent questions; both Main and Task `/show` origins stored literal slash/multiline answers with answered_by=MASTER and matching answer_request_id. Resumed Agent results contained the exact unique answer.
- L2: real scratch write approval reached CONSUMED, file bytes/hash matched; rejection produced no file and a persistent rejection_proven FAILED row. A separate real missing-file read produced an actual tool error and submit_result FAILED; both failure categories coexisted. Real error event was independently checked from the stored Agent event during L4.
- L3: same-domain controller reconnect preserved the Main rich draft and did not add an Input. Loss/duplicate/stale/external-answer/loading-reconnect cases remain offline Core evidence, not unpaused-provider race claims.
- L4: reopened the completed real-provider data with pump:false and a no-model guard; failure detail, ignored action gestures, Main/Task navigation and refresh left Store sequence, Input/ModelCall count and all retention fields identical. This phase is REAL_CORE_READONLY, not LIVE_MODEL.
- Final targeted suite: 21/21 passed, including evidence-frame negatives, partial/revoked authorization, current-draft restoration, option focus, external selection removal, loading reconnect and revision-only redraw suppression.

Full verify and exact-head CI/reviewer results will be attached to the frozen PR conversation. Native Terminal/IME and Master product acceptance remain NOT_TESTED; the UI tool refusal is not a successful native test.

## Post-smoke seen-state guard

Source audit reproduced one UI-only race: cancel a slow opening of A, open B, then let A return. The old completion could mark A seen despite never displaying it. The follow-up requires the current matter ID to match the requested ID before marking seen. A deterministic Pi-input regression fails before the guard and passes after it; the final focused suite passes 22/22 and TypeScript checking passes. The real-provider-produced domain was reopened again with the no-model guard; L4 still passes with unchanged Store sequence, Input/ModelCall counts and retention.

Smoke C's hashes remain evidence for the earlier freeze, not a claim of byte-identical final source. As of 2045305, the only later product-code delta was this seen-state guard in `tui/app.ts`; Core classification, model dispatch, directed submission and controller code are unchanged. The new regression covers the late-open behavior offline; no new provider call is claimed for it. The first full local verification was already running when this guard was added; it reaches the new regression with the guard present. The final commit's full Linux and macOS CI provide the exact-head checks.

## Implementation review R1 and R2 response

R1 reviewed exact 2045305 and independently checked the CI run as successful, but did not independently execute tests. Claude read the three new modules and relevant diffs/tests; dependency setup initially lacked the Pi submodule, and a later test attempt was blocked by its own session policy. Runtime evidence remained Codex-supplied. Verdict: CHANGES_REQUIRED, with classification accepted.

- B1 fixed: use the existing Execution state index for FAILED/RESULT_UNKNOWN and TaskPlan state index for INIT_FAILED; task ownership is cached by immutable proposal hash; failure details are memoized by execution/result version, with relevant execution/operation/authorization changes invalidating the entry. The provenance index warms at service construction. A deterministic test adds 128 successful historical executions and proves that warmed refreshes remain at zero store.read calls; it also checks ownership-hash invalidation and enforced TaskResult immutability. A first extension attempted a forbidden TaskResult rewrite and failed IMMUTABLE_RECORD; the test now explicitly asserts that rejection, with no production rule weakened.
- B2 fixed: visible Unicode format/line-separator markers in authorization/question details, option focus hints and attention rendering. Source data, authorization revision/hash, option bytes and submitted literal answers are preserved. Seeded real-Core/Pi tests cover U+202E, U+200B, U+2066, U+2028 and U+2029.
- Adopted non-blocking notes: warm the provenance index at startup; refresh this ledger; document that matter selection stops Main follow mode. Remaining notes are presentation/UX follow-ups: page-boundary selection drops safely with notice, Task/show seen-state, later-page range wording, agent-reported summary labels, and distinguishing admitted-then-externally-revoked actions. None permits stale approval or changes failure membership.
- Required R2 verification: focused suite, check/docs, exact-head CI, and L4 on real-provider domain B with explicit rejection_proven and recorded_non_rejection checks. Claude explicitly said a fresh provider run is not required for these read/display changes. Original live smoke hashes remain historical; no new paid call is claimed.

R2 local result at freeze: 25/25 focused tests, TypeScript and docs checks PASS; repeated L4 PASS with rejection_proven and recorded_non_rejection preserved, zero model calls and no state/retention writes. Final-head CI and same-session verdict will be appended to PR #99 after completion, as the workflow permits, without a status-only commit.
