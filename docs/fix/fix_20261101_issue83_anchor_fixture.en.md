# Issue #83 follow-up: deterministic Task anchor fixture

## Trigger and scope

Master accepted the Task layout and authorized the Issue #83 merge, including lowercase `/m` and `/t` defaults. PR #97 merged as `7239f54046c1fad9ec43b39200db905bdb40fe76` after R8 source review, 860/860 local PostgreSQL tests and all PR CI jobs passed. Its post-merge [main CI](https://github.com/ExplodeCode6324/Secretary/actions/runs/41240152994) then failed the macOS Task anchor test at `window.test.ts:238`. Preserve that first failure; do not silently rerun it as a pass.

This follow-up changes only test fixture selection and this bilingual record. Production source, viewport behavior, command defaults, assertions and the five-second timeout remain unchanged.

## Diagnosis

The fixture creates 13 scheduled tasks with no executions. Their documented ordering is ascending ID, not creation or due time. The first-created task has a random ID. A locate response starts at the target, so a target near the end has too little content below it to put its first row at the top of the viewport. Bottom clamping is correct; the target remains visible and highlighted.

A private deterministic probe selected the greatest ID and reproduced `CONDITION_TIMEOUT`. The captured page contained only the continued Shared header and target. The target started at document row 7, scrollTop was 0, and the highlighted target was visible. The earlier rendering-wait explanation was incomplete: waiting cannot create a scrollable suffix.

## Change and validation

1. Collect the 13 proposed plans and select the second ID in their defined ascending order. Eleven following cards guarantee a scrollable suffix after locate.
2. Preserve every existing anchor, draft, no-write and 80/120-column assertion, including the existing bounded wait. Do not increase the timeout, add retries, skip the test or change production scrolling.
3. Retain the original CI log and deterministic failing probe in the ignored Issue #83 evidence directory. Run the corrected case across 20 fresh ID sets, the focused #82/#83/#91 suite, TypeScript/docs checks and complete PR CI.
4. Submit the exact follow-up head and full diff to the same Claude Opus 5.5 Extra conversation. Fulfill its current-head conditions, use an expected-head guard for merge, and verify post-merge main CI. Keep Issue #83 open; product closure is separate.

## Evidence boundaries

The diagnostic and regression use the real Core API with fixture models and a headless Pi terminal. They establish deterministic test preconditions, not new native or live-provider acceptance. The already accepted product and real-model evidence are unchanged. Record final current-head CI and reviewer results in the follow-up PR to avoid a documentation-only review loop.
