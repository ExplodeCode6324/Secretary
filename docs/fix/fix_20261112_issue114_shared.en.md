# #114 execution plan: default Shared and visible durable task workspaces

Date: 2026-11-12 (Asia/Hong_Kong). [Issue #114](https://github.com/ExplodeCode6324/Secretary/issues/114) is OPEN; implementation is in progress on `codex/issue114-shared-workspaces`. Derived from [#111 R5](fix_20261112_issue111_world_model_scope.en.md), §§5 and 8–10, without changing reviewed scope/contracts. [中文](fix_20261112_issue114_shared.md).

## Goal and dependencies

Omitted or explicit null scope_id selects built-in virtual Shared. Each Task has an independent durable directory reused by continuation, with a discoverable location on the Core host. Keep `scope_id=null` on the wire; do not create an ordinary WorkScope to represent Shared, move historical files or rewrite immutable Execution bindings.

This work can proceed independently of [#113 Scope import](fix_20261112_issue113_scope.en.md), after refreshing main containing [#112 World](fix_20261112_issue112_world.en.md). Final integration tests imported DIRECTORY, explicit NONE and Shared on the same version. No cleanup/archive policy extension or Scope-wide shared workspace is added.

## Execution order and checkpoints

1. **Inventory entry points and existing bindings.** Trace Main/API and AGENT/PROGRAM admission, bindings, continuation and artifact paths through `scopes.ts`, `task-planning.ts`, `task-triggers.ts`, `execution-runner.ts`, `store.ts` and `artifact-path.ts`. Distinguish unbound new tasks, bound existing tasks and missing historical directories; a derived path is not proof of existence.
2. **Unify Scope resolution.** Omitted/null resolves to virtual Shared. Explicit invalid, archived or unavailable IDs fail without fallback. NONE remains a named logical group; DIRECTORY retains its approved external root. Share resolution/projection across admission/query/browser/prompt/packet rather than independently interpreting null.
3. **Keep Task-level directories stable across continuation.** Shared uses `data/core/workspaces/<task_id>/work` per Task. Executions of the same Task reuse its binding and cannot change Scope on continuation. NONE keeps independent-directory semantics; DIRECTORY uses its approved root. Reuse safety/occupancy checks. Do not rewrite historical Executions or conceal missing bound directories by creating empty replacements.
4. **Expose truthful path projections.** Views show `scope_kind=SHARED` and `scope_name=Shared`, retaining null wire compatibility. task_query, detail API/TUI, execution context, results and related artifact views show absolute Core-host path, root type, availability and Scope name. Label unbound derived paths as planned; mark verified only after actual creation/checking. Missing/unsafe roots report actionable errors.
5. **Update Main and remote presentation.** Explain the Shared default in prompts even with zero ordinary Scopes. Tool receipts and task grouping/search/sorting agree. State that paths belong to the Core host. Preserve /open restrictions and prevent treating another Task's directory as accessible. Retain fixed CAS delivery, historical attachment/artifact references and TUI navigation semantics.
6. **Generate contracts/docs and integrate.** Update necessary DTO/public schema/projection/docs/localization from sources; check old omitted/null clients and historical Execution decoding. Completion/retirement retains workspaces. Recovery does not move/delete/rebind them. Integrate #113 imported-DIRECTORY delegation and #112 restart recovery.

## Required isolated test matrix

| Scenario | Observable assertions |
| --- | --- |
| Fresh domain without ordinary Scopes | Main/API × AGENT/PROGRAM × omitted/null select Shared with consistent name/type and correct path status |
| Explicit invalid/archived/unavailable ID, NONE, DIRECTORY | Invalid IDs never fall back; three valid root kinds retain distinct behavior; no arbitrary rebinding |
| Two Shared Tasks with identical filenames | Different content survives in different directories; reads/artifacts match each task, without workspace collision |
| Same-Task continuation and Core restart | Read original files; Task/Scope/path/historical Execution bindings and CAS references remain consistent |
| Unbound, verified, missing and unsafe directories | Accurate planned/verified/error states; no fake empty recovery directory; unsafe paths fail |
| Scope changes during continuation, cross-task paths and /open | Reject rebinding/out-of-bound access; preserve existing safety and fixed CAS delivery |
| Completion/retirement and historical recovery | Retain workspaces; no normalization rewriting history; missing historical state is diagnosable |
| query/API/TUI/prompt/packet consistency | Explain Shared with no Scopes, label remote Core-host paths, keep lists/details/navigation/artifacts consistent |

Extend `test_case/offline/issue16/workspace.test.ts`, `scopes.test.ts` and existing continuation/artifact tests before adding dedicated #114 regressions as needed. Use at least two populated synthetic Tasks and controlled stop/restart to verify file bytes and bindings; retain first failures. Separate automated API/TUI projection checks from native keyboard interaction. Real-memory/native combined acceptance remains deferred at Master's direction.

## Validation, delivery and data boundaries

Refresh `origin/main`, inspect local changes and project instructions, and use an isolated `codex/` branch for implementation. Run focused regressions, generated-contract/document checks, `npm run verify`, and required Linux/macOS CI. Generate derived files from their sources. Record candidate HEAD, actual CI head/merge SHA/tree, first failures and fixes. After build/type checks, actually start isolated Core with synthetic data, loopback ports and dedicated `secretary_test_*` databases; verify readiness rather than process existence. Never pass agile paths or DSNs to test cleanup helpers.

Follow secretary-pr-fix and review the final implementation in the original designated Claude conversation. Distinguish source review, automated/API checks, real-provider checks, native TUI interaction and Master's acceptance; record PASS/FAIL/NOT_TESTED separately. Master deferred real-memory and native combined acceptance until the whole series is complete, on agile. Isolated backend checks remain required, including populated synthetic data rather than an empty instance alone. This document split is not a new technical review or authorization to implement/merge #113/#114. Follow Master's instructions at implementation time and verify main CI after any authorized merge.

Protect the running agile instance and all journal/CAS/database/workspace/configuration data. This task neither deploys nor restarts it, and does not copy real data. A later explicitly authorized deployment follows parent §§9–10: inventory pending work, quiesce without cancelling tasks, verify a full cold backup, preserve domain identity, perform non-destructive upgrade and check readiness. Beyond the new journal-format boundary, recover forward with compatible code; never overwrite newer writes with an old backup. #111 retains combined acceptance and cross-issue recovery gates.

## Retained R5 technical contracts

The following parent sections are copied verbatim, including their original numbering. They are design requirements, not additional test evidence. Shared delivery/recovery rules remain in parent §§8–10. Update the parent and relevant child together if Master later changes the design.

## 5. Shared default and persistent task directories

Make Shared a first-class documented virtual scope with a single resolver/projection used by task admission, query, browser, prompts and execution packet. Preserve scope_id=null as its wire/storage identity for compatibility; expose scope_kind=SHARED / scope_name=Shared in additive view metadata, and accept omission/null for all new AGENT/PROGRAM task entrypoints. This is automatic assignment, not absence of scope. Do not create a DIRECTORY containing all Shared tasks and do not backfill immutable Execution records.

Each Shared Task retains its own durable <data/core>/workspaces/<task_id>/work. Continuation retains the same task directory. A named NONE scope remains a distinct grouping and also has per-task directories. Directory scopes continue using their approved root. Invalid/archived explicit IDs fail rather than silently falling back to Shared. Reuse inherits its existing scope and rejects attempts to switch scope. New/queued/recovered tasks all use the same resolver.

Always describe the Shared default even when no ordinary scopes exist. Add authoritative workspace information to task_query, task detail API/TUI, execution context and artifact display where useful: absolute Core-host path, root kind, availability and scope label; before a workspace is bound, label a derived location as planned, never verified. Distinguish Core-host paths from the user's client-local paths; preserve the existing remote /open policy. Missing/unsafe directories produce an explicit unavailable error, not a fresh silently empty replacement for an existing execution. Keep fixed CAS delivery and existing history intact; no deletion on completion/retirement and no cross-task file access assumption.


## Implementation record (2026-11-12)

Master authorized evaluation and direct implementation, then tests, PR, CI and Claude Fable 5.2 Medium review, after #113 merged. Live GitHub verification confirmed PR #116 merged as `1efcc9f96737bd1034dc5d0f29d067093f89854c`; post-merge run `43203003127` passed Linux, macOS and aggregate verify. The clean local main matched that commit, and the pinned submodule remained unchanged. #114 was assigned before implementation. The approved R5 scope remains applicable; no new plan-approval gate was introduced.

Implementation centralizes Scope labels/workspace observations in Scopes, preserves null Shared identity, rejects unavailable explicit admission, and always describes Shared in Main prompts. Additive `workspace_info` views reach query/acceptance, public task/execution/result details, Task-browser detail and executor packets; paths explicitly belong to CORE_HOST. Unbound paths remain planned; bound roots are verified by a read-only check or report unavailable. Historical references to a missing ordinary Scope retain their original ID and an unavailable label, never Shared; unknown root/type may be null. Existing owner DIRECTORY edits still affect future executions as covered by #16; immutable historical bindings are unchanged.

Binding no longer recreates a lost private directory. The established first DIRECTORY-to-NONE transition may create a private directory only if no prior private execution exists. Initialization checks symlink ancestors before writes. No history/CAS migration, deletion, cleanup policy, agile access, deployment or merge is included.

First failures retained privately: initial tests used a nonexistent command/result route (test harness corrected); the generic public projector removed the reserved `workspace` field (fixed with typed `workspace_info`, preserving redaction); full verification hit `SCOPE_NOT_FOUND` for historical fixture references (read projection made diagnostic without relaxing admission); the terminal test exposed macOS `/var` alias versus physical Scheduler-root disagreement (derived display roots now use the same canonical Core root). The original 48-test focused run had 47 pass and that one terminal failure; its focused correction passed 1/1. Thirteen Shared/Main/program/retention tests passed, followed by the terminal projection regression. Full verification restarted after the historical and physical-path fixes; results and exact-head CI/review will be recorded in the PR rather than claimed here while pending.

An isolated PostgreSQL-backed fixture Core started via actual package scripts and reached IDLE with World supported. Two approved PROGRAM tasks wrote separate same-name files with distinct bytes through HTTP. Controlled restart/continuation checks are in progress. Automated terminal rendering is not native keyboard acceptance. Real-provider, native TUI and combined agile real-memory acceptance remain NOT_TESTED/deferred under the #111 series decision; no agile configuration, data or process was changed. Raw requests, replies, first failures and runtime evidence stay in ignored `.demo-data/issue114/`.


## Master scope amendment: hard cut for legacy out-of-Scope tasks

During #114 implementation, Master explicitly directed a hard compatibility cut: there is no formal data requiring preservation, and old out-of-Scope task data may be discarded. This supersedes the legacy task compatibility/preservation requirement for that data; it does not relax persistence, isolation or missing-directory checks for tasks admitted by the new implementation. No migration adapter, invented Scope or tolerant dangling-Scope projection is required. The initial diagnostic compatibility branch was removed: a missing explicit Scope remains SCOPE_NOT_FOUND. The pagination fixture now creates real NONE Scopes through the supported admission path, with all original pagination/filter/cursor assertions retained. No existing instance was deployed to or cleaned during this source change. Final full verification was restarted for this amended source; earlier interrupted runs remain first-failure evidence, not final PASS.


### Continuation budget regression

The amended full run found #21 S2 CAPACITY_BLOCKED (input 54123 versus usable 54067) after the expanded default-Shared prompt. The first two shorter wordings admitted the initial request but left too little space for the minimum memory page, so the original nonempty-page assertion still failed. The final correction removes the redundant empty Scope-list envelope and compresses task_propose wording while retaining each instruction. No context limit, reserve, page assertion, fixture input or memory-tool budget rule changed. Targeted #21 read plus #114 regressions passed 17/17; typecheck and docs checks passed before restarting full verification. Raw first failures remain in the private evidence directory.
