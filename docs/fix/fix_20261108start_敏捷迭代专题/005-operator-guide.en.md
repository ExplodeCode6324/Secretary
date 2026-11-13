# AG-01–03 · Operator guide and verification boundaries

[中文](005-操作与验证.md) · [Approved plan](005-implementation-plan.en.md) · [Prompt inventory](005-prompt-inventory.en.md)

Master authorized implementation and a brief interruption on 14 November 2026. Implementation branch: `codex/agile005-readonly-diagnostics`, PR target `agile`. The production checkout stays on `agile`; run tools from the independent source clone. Never start a captured copy. The final exact-HEAD review and CI results belong in the PR; merging requires separate authorization.

## Entry points

The macOS capture command uses the existing agile lifecycle entry point with the pinned Node launcher and a minimal environment. PostgreSQL stays running. No production dependency installation, model invocation, API/schema change, prompt edit or TUI change is part of this batch.

Use canonical absolute paths. `ROOT` below is the sole live agile directory; `TOOL` is the independent reviewed source clone. `CONTROL`, `BACKUP` and report output directories must be private directories outside the live roots, with CONTROL outside BACKUP. Values below are placeholders, not an auto-run shell script.

1. Close the TUI normally so its state is saved. Master's permission to stop allows the exact TUI process's graceful SIGTERM handler; do not kill it forcibly or clear its draft. Verify Core/runtime/source equivalence and the reviewed tool SHA. Existing maintenance or a stopped Core causes refusal.
2. Write a private inventory JSON with `data` and `.local` objects, listing **every immediate entry**. Classifications: `frozen`, `operational`, `logical_postgres`, `socket_metadata`. Core/TUI/config/review evidence are frozen. `data/postgres` is logical; `data/pgsocket` is metadata. `data/world-postgres.log` and continuously written PostgreSQL/supervisor logs are operational. New/unknown entries cause refusal; classification never permits deletion. This implementation refuses registered external Scopes and mutable-root symlinks; it does not guess an external mapping. Resolve such cases in a reviewed extension before capture.
3. Run fresh preflight. It reads bounded existing APIs (one memory GET), checks TUI/startup processes, PG identity/version and root classification. Use its capture ID within five minutes:

```sh
node "$TOOL/scripts/agile-diagnostics/capture.mjs" preflight --root "$ROOT" --inventory "$CONTROL/inventory.json" --output "$CONTROL/preflight.json"
node "$TOOL/scripts/agile-diagnostics/capture.mjs" capture --preflight "$CONTROL/preflight.json" --capture-id "$CAPTURE_ID" --inventory "$CONTROL/inventory.json" --backup "$BACKUP" --state "$CONTROL/phase.json"
```

Run the second command as a supervised detached process with private stdout/stderr, retaining the PID. Do not let a tool timeout terminate it. Inspect `phase.json`; it is fsynced before and after transitions. P0 holds the owned marker for at least 35 quiet seconds, then repeats the bounded quiescence gate. Same-second ensure processes count as pre-marker. Later start-live/core-cli/start processes remain mutation-capable. P1 stops Core and waits for its owner/helper tree, then locks the existing Core and actual nested TUI lock files. P2 dumps the still-running database; P3 copies/seals; P4 releases locks and restores the original service. Source files are archived before interruption. Existing startup code, source Git/dependencies and untracked static files are retained in `source.tar`; no launchers are unpacked into `instance/`.

4. Recovery is explicit and repeatable:

```sh
node "$TOOL/scripts/agile-diagnostics/capture.mjs" recover --state "$CONTROL/phase.json"
```

The exclusive coordinator lock prevents recovery while the original coordinator is alive. P0 recovery removes only its owned marker and checks the existing instance. After stop, it waits for original owners to exit and never starts a competing Core. A foreign marker or changed PG identity blocks automatic restart. The narrow existing stop-command marker rewrite is accepted only with recorded inode, timestamp and expected payload. SIGINT/TERM/HUP take the same recovery path; SIGKILL requires the persisted-state command. No failure is a reason to restore older journal/database state. Target capture work is 180 seconds after stop, followed by a 90-second recovery budget; these are operational deadlines, not a guarantee that an unresponsive process cannot extend downtime. `RECOVERY_FAILED` needs operator attention before any manual start.

5. A completed capture has `manifest.json` status `CAPTURED`, original data domain/session, a new Core instance identity, unchanged PG process/binary, journal-prefix continuity, static CAS/source archive/file checks and `pg_restore --list`. `maintenance-transitions.json` privately lists failure/cancellation/interruption records added during the window; temporal association does not establish causation. Backup marker `instance/.local/maintenance.json` is immutable (`uchg`) and code is archived; intentional bypass is still possible.

6. Generate explicit offline reports outside the captured directory and production data roots:

```sh
node "$TOOL/scripts/agile-diagnostics/report.mjs" usage --snapshot "$BACKUP" --output "$CONTROL/usage.json"
node "$TOOL/scripts/agile-diagnostics/report.mjs" memory --snapshot "$BACKUP" --output "$CONTROL/memory.json"
```

Usage optionally accepts `--from`, `--to` (ISO time, half-open interval), `--timezone` (default Asia/Hong_Kong), `--task`, `--execution`. Explicit operator budget overrides: `--max-journal-bytes`, `--max-cas-bytes`, `--max-milliseconds`. Defaults: 64 MiB journal/single record, 256 MiB total CAS reads including every mutation snapshot, 100,000 mutations, 30 seconds, 1 MiB output, 200 detail groups. Filters do not avoid scanning history. Missing/corrupt/truncated/over-budget input fails `INCOMPLETE`; no fabricated global totals. Output creation is exclusive and mode 0600. These scripts have no Core/Store/Host runtime imports and make no HTTP/DB/model calls.

## Interpretation and limitations

- Attempts are ModelCall identities; started attempts and payload preparation precede actual fetch. **Physical sends and prices are unavailable.** Latest saved response usage is counted once per call identity, including saved aborted responses. Equal response bodies from distinct calls are not deduplicated. Every token field exposes known/missing/literal zero. Logical-key anomalies retain usages; time-window splits remain visible.
- Authorization uses first creation/first recorded decision. Revoke/consume does not reset wait. Expiry still recorded as PENDING is inferred, not a decision. Repeats require exact action/resource/full scope/revision/serialized parameter hash; retries and independent repeats are separate. No approval changes follow these statistics.
- Memory fields have source, observation/capture time, method and availability. Latest job follows first insertion order. Extraction predicates match memoryStatus. Checkpoint source/policy/digest criteria are separate; actual database counts are **not verified**, and partial matches never prove search readiness. Recall is the last captured prompt, not live behavior. Request budgets and payload token estimates are not cumulative billed usage or bytes.
- Reader validation is static framing/schema/references/revisions, not full Core business replay. Known message/image envelopes have references validated without image hydration; logical request reconstruction is unavailable. No backup code runs. Source archive preserves file bytes/modes/links; macOS extended attributes/resource forks are not a claimed recovery contract. Sockets/FIFOs are represented as metadata, never copied as active endpoints.
- Reports are private. Reconcile at most 20 real call/request IDs; absent Task/approval activity means no real sample, with synthetic coverage reported separately. A public synthetic sample can be generated from the tests; no real private prompt/error/parameter text belongs in the PR.

## Restore draft — NOT_TESTED

Keep newer live writes. Obtain separate authorization for the restore target and downtime. Use matching source, Node/dependencies, compatible PostgreSQL and pg_trgm; initialize only an explicitly test-owned empty cluster, review globals/role/config adjustments, restore the custom dump, then Core/TUI/config and preserved request identities. Rebind **every absolute path** in runtime/config/source and external roots to the restore target. Handle stale endpoints/locks through supported ownership procedures. Remove `uchg` only on the authorized restore target, never the retained original backup. Then validate the full application in that isolated target. This batch does not run that process, does not claim full semantic recovery or offsite disaster recovery, and does not start a second local Core/PG.

## Checks and first-failure record

Local file-only checks: `npm run check`, `npm run docs:check`, Node syntax for new mjs, Python compilation, and `node --import tsx --test test_case/offline/agile-diagnostics/*.test.ts`. The first runs exposed fixture issues: macOS `/var` alias, invalid synthetic Digest/UserInstructions/approval values and a message-envelope fixture placed in the wrong Context field. Fixtures were corrected to actual contracts; no production contract was relaxed. The pure suite currently has 45 tests covering aggregation/selection, invalid input/budgets/output paths, envelope references, phase failures/recovery ordering, idle gates, startup race classification and real OS lock exclusion on synthetic files.

CI additionally runs the full Linux suite and the macOS regression list. Real Store differential tests live separately in `test_case/offline/agile-diagnostics-ci/` and skip without `CI`; they never use the agile domain. The local suite does not simulate a real PostgreSQL failure or prove all macOS supervisor race interleavings. Full restore, real-model connectivity, native IME/UI and the memory benchmark remain NOT_TESTED. Exact executed capture/report results are recorded after CI and implementation review, not presumed here.
