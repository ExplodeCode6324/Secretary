# Document consolidation and agile baseline

## Authorized scope and sequence

Master authorized the 2026-11-08 cleanup: freeze the old baseline and delete obsolete branches; archive scope A after approval; absorb useful historical design into current documentation and remove the old design directory and its active references. Master then requested Claude review, publication/alignment of main, and alignment of the single agile instance to the documentation-complete main as its new baseline. Merging agile into main still requires separate explicit permission.

## Completed work

- Scope A: gracefully stopped three old Cores and the acceptance client; dumped and stopped three old PostgreSQL clusters. Copied and individually SHA-256 verified 207,412 files (4,024,643,041 bytes), including 14,350 untracked report files, before removing source copies. Repaired both detached worktree paths. The private archive is in Master's designated desktop backup directory.
- Archived and verified 114 local old-design files (112 tracked), then removed them. Obsolete JSON/SQL/state-machine copies and early validation scripts are no longer build inputs.
- Current architecture, data flow, invariants and owning source already cover the durable storage, cross-store receipt, authorization and recovery rules. No obsolete state table, protocol or unimplemented feature was promoted into a current contract.
- Architecture now states that Execution retirement does not delete data, the default expiry is 48 hours, ordinary queries do not refresh it, and backups cover Core, PostgreSQL, client recovery material and external working roots.
- The TUI guide consolidates draft/request identity, acceptance versus completion, reading versus following, transient previews versus durable sync, and separate notification states. It does not inherit SwiftUI layout, old shortcuts or retired-client implementation claims.
- The test index consolidates evidence categories, fault oracles and first-failure retention. It explicitly separates the single persistent agile instance from historical launchers and destructive test fixtures.
- Navigation, migration destinations, translation catalog and generated pages are updated. Every historical fix file remains. Only dead active links in a few plans are replaced with immutable baseline provenance; historical path/fingerprint inventories remain factual records, not current dependencies.

## Verification and review

Run docs:check, typecheck and diff checks. Verify runtime/test source, schemas, dependencies and CI are byte-identical to the old baseline; all 218 historical fix files remain, with only dead-link edits. Distinguish source review from runtime testing and do not claim new product acceptance.

Claude Opus 5.5 Extra reviews the finished documentation and patch. Address review findings before publishing the documentation commit to main and checking its CI. Then merge main into agile, record the new exact baseline, preserve all data/private configuration, and verify the same live domain and history. Agile-only deployment changes must not enter main.

## Review corrections

R1 corrects retention conditions and post-retirement behavior against source. R2 adds TUI state backup to operations. R3 pins historical plan citations to the old commit for provenance only; no active document depends on the removed directory. R4 documents the new plan location and extends the documentation link checker to root `fix/`. The stale frontend landing page now points to the implemented TUI. Runtime/test source remains unchanged; the only script change adds `fix/` to documentation checking. The retention regression checks journal preservation and the retired state; CAS/workspace preservation is established by source inspection, not claimed as test coverage.
