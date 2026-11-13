# 005 · Tonight's Small Changes and Read-only Diagnostics

**14 November 2026 (UTC+08:00) · R2 work-package handoff · Awaiting Codex implementation refinement**

[中文版](005-今晚小改动与只读诊断.md) · [Subsequent roadmap #119](https://github.com/ExplodeCode6324/Secretary/issues/119)

## 0. Deliverable and authorization boundary

Master decided that small, non-invasive improvements should first be exercised on agile, with a separate decision to merge stable work into main. Memory reliability must be qualified in a dedicated resettable benchmark environment before capability expansion. This file covers **Stage 1, tonight's batch only**. AG-01–AG-04 have no issues. This documentation commit performs no backup, test, deployment, service restart or runtime-data modification.

The basis is R1, Claude's 14 November review, and Master's subsequent acceptance of the discussed disposition: narrow the first gate, separate clock implementation, retain the resource pass/fail gate and M3 provenance/authority checks. This is not a new Claude PASS or a substitute for Codex's detailed implementation plan.

The remote source checked for this handoff was `agile@6bdc0ea48783a0ce55772a804c2f729e8f5f4d2a`, including merged visual PR #118. This is a repository reference, **not evidence of the local checkout, uncommitted changes or running process version**. Preserve package 004, Luna/Sol assets and existing visual work; do not redesign the character or layout.

## 1. Codex preflight

1. Read this directory's 000/002/004 records and the actual current startup instructions. Check checkout, branch, HEAD, dirty work, live Core/TUI identities and data domain. Do not reset, clean, overwrite unrelated changes or blindly pull; inspect differences before bringing remote documents into the local checkout.
2. Confirm the unique persistent agile roots (`data/core`, `data/postgres`, `data/tui`), actual private configuration and external Scope roots. Verify actual locations and keep sensitive details out of public output.
3. Refine each AG item into inputs, outputs, exact commands, read-only boundary, expected changed files, necessary service coordination and rollback. Move schema/API/authorization/task-state changes to later stages rather than enlarging tonight's work.
4. State the exact work branch and review/deployment route, based on the freshly checked agile revision. Use attributable small commits and the existing approval/CI/local-acceptance process. Main merging is not automatic. Never restore older user data to make a code rollback convenient.

## 2. Fixed scope and order

| Order | Item | Minimum output | Excluded |
|---|---|---|---|
| 1 | AG-01 Coordinated capture and static integrity checks | Private backup, manifest, read-only check results, draft restore instructions | Booting a real assistant copy, hot-backup engineering, scheduled nightly downtime, GC |
| 2 | AG-02 Read-only usage and repeated approvals | Explicit report command and one reconciled sample | A competing ledger, budget shutdown, trust profiles, automatic approval/retry |
| 3 | AG-03 Existing memory diagnostic snapshot | A bounded report with sampling boundaries | New Core contracts, model calls, memory repair or forced maintenance |
| 4 | AG-04 Prompt inventory; UI changes only from an enumerated list | Rule classification; no UI implementation selected by default | Broad prompt changes, generic UI improvement, replacing 004 visuals |

AG-02/03 read the stable AG-01 copy by default. Existing lightweight `core status` or already-provided read-only interfaces may be used when needed, without new full-history hot-path scans. Keep backup/report/evidence artifacts private or ignored; publish only scripts, sanitized examples and conclusions.

## 3. AG-01: capture and static checks

### Work

- Inventory the actual Core/journal/CAS, TUI unsent requests and recovery materials, private configuration, PostgreSQL database and external Task/Scope files. Record version, capture time, domain and exclusions. Preserve original request IDs; unsent requests are not merely rebuildable cache.
- Refine and follow the existing coordinated/stopped-writer capture procedure. Account for TUI state and Core writes; perform any necessary stop/start only under the applicable authorization. Do not forcibly terminate Master's active client. Distinguish stopping Core from stopping PostgreSQL. A running PostgreSQL cluster needs a declared database export/supported backup procedure, not arbitrary copying of its active data directory.
- Establish a coherent capture boundary across Core, database, TUI and external roots. Identify other writers; uncoordinated copies cannot be labelled consistent. Do not change the continuous-running/no-instance-budget policy.
- Use existing read-only CAS verification and static manifest/hash/file-integrity checks. Do not test unknown Store initialization, migration, write or business-pump entry points against a real assistant backup.
- Produce a manifest with source SHA, capture boundary, included/excluded material, database-export method, checks, gaps and required restore version/steps. No secrets or DSNs in public output.

### Acceptance wording

**This item may establish a declared coordinated backup capture and the listed static checks, not a completed full application restore.** A boot-and-continue restore drill belongs to [#120](https://github.com/ExplodeCode6324/Secretary/issues/120), using benchmark-created state rather than automatically starting this real assistant backup.

- [ ] Scope, time, file/database method and static checks are verifiable; original data and historical failures are retained.
- [ ] Any authorized stop/start records identity and continuity; there is no second live assistant dispatching schedules or notifications.
- [ ] Unverified restore boundaries remain explicit; hashes do not substitute for boot/restore evidence.

## 4. AG-02: read-only usage and approval report

### Work

- Aggregate existing records by day, Task/Execution and model role. Separate Main, Task and maintenance when evidence permits; otherwise mark unclassified use.
- Show physical sends, successful calls, failed attempts, known input/output usage and missing usage. Recovery/retry must not count the same saved successful response twice. Missing values are not zero.
- Show estimated currency only when price metadata has a declared source and version; otherwise report tokens. Cost, cumulative usage and one request's context occupancy are distinct quantities.
- Count authorization requests, recorded waiting durations, remembered-rule use and parameter-identical repeats. Equality means exact recorded parameters, not model-inferred semantic similarity. Do not auto-approve or automatically widen permissions.
- Run explicitly on demand, with useful time/task filters. Do not scan all history on every TUI refresh/Core tick. Record read volume, time, range and truncation. Reporting must not rewrite the source ledger or drive business behavior.

### Acceptance

- [ ] Reconcile a selected sample against individual source records; distinguish physical attempts, logical calls and deduplicated saved successes.
- [ ] Missing usage/prices/wait times remain visible; no private transcript or credential disclosure.
- [ ] Authorization, task and Core state remain unchanged. No burn guard, automatic pause, instance request budget, retry or trust profile.

This is separate from usage-based **context accounting** in [#123](https://github.com/ExplodeCode6324/Secretary/issues/123). Tonight reads existing evidence; it does not change accounting or maintenance triggers.

## 5. AG-03: bounded memory diagnostics

Use the stable copy and existing read-only status to expose available Consciousness revision/coverage, latest maintenance outcome, pending/failed extraction or maintenance counts/reasons, search status/watermark, available recall mode/diagnostics, and request-size measurements with their method.

For every field declare **source, sampling time and availability**. Backup state is state at capture, not current state. Live lightweight status and an older copy are not an atomic snapshot. Mark absent fields unavailable rather than creating a public API or inventing precise derived status.

No model calls, World/Consciousness writes, forced compaction, search-index rebuild or extraction retry. Do not repair errors merely to make the report clean. Bound reads and output; keep private originals out of Git.

- [ ] Distinguish missing source, failed/lagging maintenance, unavailable search and capacity pressure where observable; list gaps.
- [ ] State sampling boundary, read method, elapsed time and size; existing lightweight status does not introduce expensive scans.
- [ ] Business records do not change because of diagnostics. Necessary new Core instrumentation moves to Stage 2.

## 6. AG-04: enumerate changes; do not invent UI scope

**Currently confirmed new UI implementation items: none.** Therefore the default batch includes prompt inventory only, not unspecified TUI changes under the heading of aesthetics or status clarity.

Classify current prompt rules as planning guidance, host-enforced constraints or duplicated/historical material, retaining locations and reasons. This is documentation work. Host rejection does not make planning guidance automatically removable. Behavioral changes require #121/#122 comparisons and #124's evidence-led work.

When actual feedback supplies a concrete UI defect, Codex must first add a numbered row and obtain Master's confirmation before implementing it:

| ID | Reproduction/current behavior | Target display change | Files/base | Unchanged interaction | Validation |
|---|---|---|---|---|---|
| To be specified | Not selected | Not selected | Verify first | Input/approval/navigation/recovery | Actual affected TUI path |

Preserve 004's delivered visual work. No new pages, approval flow, navigation model or broad layout rewrite.

## 7. Benchmark exception, previous rules and U0

The 000 rules protecting real agile state, forbidding its reset/database clearing and keeping credentials/data private remain effective. Master's newly approved benchmark is a **dedicated resettable test domain**, starting with #120. It is not another permanent assistant or permission to clear/clone-operate real agile state. Stage 1 does not launch this new environment or run old destructive online launchers.

Production Core repairs have the **U0** prerequisite defined in [#119](https://github.com/ExplodeCode6324/Secretary/issues/119): Master's explicit confirmation of the Main/Task input, approval/question, history, guidance and recovery interaction baseline. This document does not supply that confirmation. Later cosmetic changes alone do not revoke an accepted baseline.

Tonight excludes search/fetch, external agents, Computer Use, MCP, automatic retries, wider permissions, semantic clocks, memory schema/lifecycle changes, daily episodic summaries and broad prompt rewrites. A small diff is not permission to add capabilities early.

## 8. Optional preparation using spare allowance — no agile-domain access

Only in an explicitly separate workspace and under the work assignment, draft #120 reset-ownership guards/refusal tests against disposable stand-ins, or **development** scenarios for #121/#122. No real effects or inherited production environment. Cases written/seen by the tuner are not unseen hold-outs. This is preparation for existing later issues, not Stage-1 acceptance and not a reason to widen product scope to consume allowance.

## 9. Implementation delivery checklist

Codex's refined small commits record base/head, affected behavior, exact commands, private evidence locations, first failures, retests, NOT_TESTED, process/real-data contact and local-versus-remote differences. Public evidence contains no raw private logs, credentials or real-user records.

- [ ] AG-01 capture/static checks completed; untested full-restore claims remain excluded.
- [ ] AG-02 reconciles; AG-03 is bounded and does not alter memory.
- [ ] AG-04 is inventory only by default; any UI implementation has its own numbered confirmed case and real-path validation.
- [ ] Applicable existing syntax/type/docs/regressions run and omissions are recorded; never point full tests at production PostgreSQL.
- [ ] Chinese and English scope/results agree; the intended tonight batch does not force incomplete work to be marked passed.
- [ ] Small changes are inspected on the existing preserved agile domain; later main promotion is Master's separate decision, without an invented mandatory one-week waiting period.

## 10. Subsequent issue navigation

#120 isolation/restore → #121 data/scoring → #122 closed-loop baseline → #123 hot paths/accounting → #124 conditions/lifecycle → #125 clocks/resources → #126 qualification/integration. Original #70/#71 moved to #123, #72/#73 to #124 and #74 to #125; migration is not completion.

Stage 3: #127 search/fetch → #128 external-executor trial/adapter → #129 result verification. #130 retains the complete 22-item mapping and conditional needs. Original #84 and #111/#114 acceptance and device freezes remain intact.
