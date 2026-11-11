# #112 implementation record

Master authorized direct implementation of #111's first child, #112, using the already reviewed R5 World Model / Scope plan. This slice covers Store-backed World, the shared acceptor, exact batch approval, roles/aliases, profile/recall and legacy genesis. Scope import and Shared remain #113/#114; no incomplete scope.import transition is enabled.

Work uses an isolated codex/ branch. The persistent agile instance and unrelated source-workspace document moves are preserved. Merge and deployment require separate Master authorization.

Validation requires first-failure evidence, batch atomicity, role/source protection, withdrawal, approval/expiry/crash races, Settings separation, 40 development probes, 40 held-out probes authored after policy freeze, 10k performance, populated legacy import, full verify, actual isolated startup, final-HEAD CI and Claude Opus implementation review. Automated, real-provider, native TUI and Master's acceptance are recorded separately; unexecuted checks are not PASS.

Status and evidence will be updated after code freeze. Historical SQL-specific tests are retained under test_case/historical/offline/world-sql-pre112; their retired SQL/Settings-write assertions are replaced by Store/approval/import/recall coverage under issue112. Independent Settings summary/crash and PostgreSQL log-search checks continue to run.
