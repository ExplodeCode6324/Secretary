# Issue #91 plan review

2026-10-30 (Asia/Hong_Kong). Current status: IMPLEMENTING / R4 FEASIBILITY_CHANGES_REQUIRED / §13 PENDING_MASTER_APPROVAL. R1–R2 planning statements below are historical; Master subsequently selected B and approved implementation.

- Master requested secretary-pr-fix, bilingual plan, browser Claude Opus 5.5 Extra, then explicit approval before implementation; real model integration verification is mandatory after implementation.
- Issue #91 assigned to authenticated repository owner ExplodeCode6324; Codex claim recorded in issue comment 6519980142.
- Current main / local plan base: `9324283c58f65cc5d783d0f3a33f79ca14575689`, includes #82 through PR #95. Branch `codex/issue91-main-history-plan`.
- Model UI independently read as `Model: Opus 5.5 Extra` on Master's existing new-session tab.
- Raw material: Git-ignored `.demo-data/issue91/review/`. Same reviewer session: https://claude.ai/chat/e293d3d9-8bbc-4454-b0cc-cf96588887ed . R1 submitted 2026-10-30 18:07:50 HKT; first read not before 18:17:50 HKT. First read no earlier than ten minutes after sending; later reads every five minutes if still incomplete.

[中文](../../fix_20261030_issue91_main_history.md) · [English](../../fix_20261030_issue91_main_history.en.md) · [Acceptance](acceptance.md)

| Round | Result | Codex disposition |
| --- | --- | --- |
| R1 | CHANGES_REQUIRED (15-minute read) | Accepted B1–B5; concretized paste seam, streaming revision handling and limit=1 relocation/fallback. Removed proposed offset API; clarified Markdown block anchors, cache accounting, live driver and state rollback. New arbitrary draft quotas disputed with #82 scope evidence. |
| R2 | PASS (10-minute read) | All B1–B5 closed; R6 quota demand withdrawn. Reviewer checked complete EN/ZH consistency. Accepted handoff corrections 2–8 incorporated into both plans and the ledger without another required round. Single-line tokenization is an explicit Master decision. |

Approval gate comes directly from Master and secretary-pr-fix phase 1 step 4. Plan approval does not authorize merge. Raw reviewer statements must be distinguished from independently observed implementation evidence.

Planning checks: `npm run docs:check` passed (117 localization sources / 351 localized pages), and `git diff --cached --check` passed. Only the two plan files, review record and acceptance template are staged. No product code, dependency, runtime test, business model call or implementation PR has been changed/started. Source audit notes remain in the ignored review directory.

R1 reviewer reports independently cloned exact Secretary and Pi refs, read the implicated source, and ran two Linux headless Pi Editor probes. No repository typecheck/tests, Core/provider or native macOS ran. Codex checked source; did not reproduce those probes. Raw reply saved from visible DOM; an initial clipboard read returned stale request text and was replaced with the verified response text.

R2 submitted UTC 2026-10-30T10:33:45.960Z; first read not before 2026-10-30T10:43:45.960Z. Full English and Chinese R2 supplied for consistency review. R2 docs check and staged whitespace check passed.

R2 bilingual structural check passed: same base/revision, section count, AC set, parameters and L1–L4 presence; this checks text structure only, not semantic review. The pending Claude R2 request includes both full language versions. Product code/package/workflow diff remains empty.

## Final handoff

R2 submitted 18:33:45 HKT, read after 18:43:45 HKT. Claude verdict: **PASS**, “R2 is ready to go to Master for approval. No blockers remain.” The two handoff conditions are now handled: (1) the plan explicitly presents A all-paste tokens versus B editable single-line pasted spans for Master's choice; (2) the requested word-operation vectors, streaming discovery, actual replay evidence, live multi-fragment limitation, cursor-anchored edits, byte-threshold rule and stale API wording are incorporated in §11 and acceptance. This is readiness to request approval, not approval itself.

R2 reports two additional Linux headless Pi probes: undo/kill hooks are reachable and a complete whitespace-aware word override works. No repository typecheck/unit/full tests, Core/provider or macOS were run by reviewer. Codex has not locally reproduced its scripts. Reviewer read the full pasted EN/ZH texts and found them materially consistent; remote plan branch was not available. No Hermes fallback.

The proposed all-paste token design changes single-line UI behavior, so general plan approval must not silently imply that choice. If Master chooses editable single-line pastes, amend the provenance design and return that change to this same reviewer before implementation. Multiline Hermes behavior is fixed. The registered final-newline line-count convention and singular `1 line` wording are in §11.

Implementation/native/live/CI rows remain NOT_TESTED. No implementation PR or code/dependency/workflow changes exist. Raw R1/R2 requests, visible-DOM replies, AX captures, timing and screenshots are in `.demo-data/issue91/review/`; final PASS screenshot is `r2-pass.png`.


### R3 — B amendment

Master approved implementation and confirmed inline single-line <=30 grapheme clusters; longer or multiline pastes fold. Same Claude Opus 5.5 Extra session, submitted 2026-10-30 10:59:05 UTC; first read after 11:09:05 UTC. Verdict CHANGES_REQUIRED, with explicit implementation clearance after five prescribed corrections and no further plan round unless disputed. Codex adopted all corrections in bilingual §12: TAB blocks, complete unknown migration and bound pending retry, typed-slash-only completion, unknown fallback attribution, and occurrence-based atomicity. Reviewer ran one reported Linux headless probe; no repository/Core/native/live verification. Raw response and screenshot retained under ignored `.demo-data/issue91/review/r3-*`. Final implementation review remains required.

### R4 — oversized Markdown feasibility

Same Opus 5.5 Extra session, submitted 2026-10-30T11:45:01.137Z; first read after ten minutes. CHANGES_REQUIRED: reviewer-reported pinned Pi probes reproduced format failures at arbitrary fragment cuts. Codex accepts the blocker and wrote the concrete complete-block/exceptional-format-boundary proposal in bilingual §13 for Master approval. Independent fixes and tests continued; the replacement renderer has not been implemented. Mouse/restore cursor concerns were addressed. See [implementation checkpoint](implementation-review.md) for independent real-Core/provider/PTY evidence and limitations. Raw request, visible-DOM response, timing and screenshot: ignored `review/r4-*`. No final exact-HEAD implementation review or merge approval.
