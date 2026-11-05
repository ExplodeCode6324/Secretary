# Issue #94 implementation review

Same reviewer conversation: https://claude.ai/chat/8bc2b4fd-2faa-4f9c-9e75-bf256cc3a91d . Model observed: Opus 5.5 Extra. Master approved implementation after R4, including PR/CI and an isolated manual instance; merge remains separate.

## R5 — CHANGES_REQUIRED at 920357964e5a03b9970015a073471fa6f17a10ca

Claude fetched the exact commit and read Core/TUI/tests/workflow diff against 578bcc2e. Its environment refused repository-code execution, so none of the supplied tests/provider results was independently reproduced by Claude.

Accepted and implemented:

- D1: eligibility/probe/platform/file-reference/no-image failures create no draft material. Check image capability before persisting a CAPTURING attempt, still before reading pixels. Actual pixel-read failures/races retain one FAILED material. Added app-flow persistence/notice tests.
- D2: an advertised image with null/undefined/empty pixel data reports CLIPBOARD_IMAGE_UNAVAILABLE in both modes; never reads accompanying text. Already fixed in e07d55aa; expanded test to JPEG plus text types.
- D3: removed Ctrl+Left/Right artifact paging (macOS may intercept it). Ordinary Up/Down crosses mapped artifact boundaries, with explicit previous/next markers and an artifact-specific reading anchor. Running VirtualTerminal + actual Core test traverses 32 artifacts forward and backward. Native key acceptance remains pending Master.
- D4: artifact-list cursors bind session, task, execution and canonical path filters. Cross-filter cursor reuse is rejected, tested against actual service.
- D5: literal star in relative paths is encoded as %2A for CoreClient's route grammar; star, plus, Chinese and spaces round-trip unchanged.

Also reset vanished image-row focus and report capture-busy/not-attached conditions. No Core journal/replay changes were made for this round.

Focused review-fix run: 28 passed. R5 source checks accepted description validation, frozen current-path versus CAS, ID-only atomic sidecar and unchanged message identity/recovery, ownership/pagination bounds, local opener restrictions, fixed clipboard probe, v3 migration/outbox recovery, source-derived admission audit, and cache accounting.

## Evidence boundaries and pending gates

- e07d55aa Linux/macOS/aggregate CI passed (run 41911810254); macOS 407/407. This is prior-head evidence; the review-fix HEAD needs its own CI.
- Local initial full run: 966 total, 963 pass, three reason/legacy-fixture failures fixed. Subsequent local verify observed unchanged issue17 AUTH-06 fixture failing before its behavior assertion because its execution was absent; original file rerun passed 10/10. Retain both raw logs; do not call that local run clean. Final Linux CI runs full verify including PostgreSQL.
- Real Main vision recognized a fresh image/code with exact provider-block hash correlation, but capture was synthetic. Native capture/viewer acceptance remains NOT_TESTED.
- Three real Task model calls failed provider region restrictions. Master decision is required before replacing the unavailable Task model; no replacement tasks or reset budget. Registered live artifact delivery remains BLOCKED.
- Master native acceptance and merge authorization remain separate. No GO, merge or issue closure is claimed.

Raw requests/replies/screenshots are ignored under .demo-data/issue94/review/. R6 will review the exact fix commit; final frozen-head CI/reviewer evidence can be recorded in PR comments without a status-only commit.

### R8 provider retirement delta

Claude reviewed `29f5b317` and requested an operations migration note, explicit plan/evidence scope, and a no-network retirement-guard regression. These are included in the follow-up. The check exercises both retired IDs without role credentials, fixture mode, and official DeepSeek catalog resolution with image input. The changed #94 harness at `05b2f11e` uses OpenAI at Master's later direction. Proposal accounting and the required scope verification are recorded in the acceptance ledger. HTTP statuses require a response; Run B transport failures are captured by the cumulative attempt ledger and the TLS probes. The reviewer inspected source and did not run repository checks.

### R9 and fallback evidence

R9 granted a conditional source/implementation pass at `f469ce95` and explicitly closed the two retirement findings. We added the official GPT-6 image sizing and accounting details to the acceptance ledger. OpenAI failed before headers and was not resumed. Master authorized a direct DeepSeek fallback, whose model-discovery check, actual Task and image results, and individually approved read-only command are recorded with Run C. Exact final-commit CI and Claude's decision are recorded on the PR after code freeze.
