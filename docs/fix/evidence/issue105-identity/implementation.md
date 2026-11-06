# Issue #105 implementation evidence

Master approved the reviewed bilingual plan on 2026-11-07. Implementation is on `codex/issue105-identity-plan`, based on `5aa5753a940e38164582fdc3368e8e307e6f5c2f`. No merge is authorized.

## Implemented behavior

- Persisted immutable domain-wide titles, creation-only advisory candidates, permanent execution rounds and atomic high-water advancement. Exact receipt fingerprints retain absent/null legacy compatibility.
- Durable pre-frame identity validation and a resumable startup migration before business recovery. Old journal bytes and object references remain intact; archived/retired records retain identity. A durable activation event closes the legacy-creation boundary. Replay does not rerun Unicode normalization.
- Title/round projections, ambiguity-safe locators, bounded typed suggestions and read-only exact-round resolution. The dedicated suggestions route avoids constructing the browser list. RESULT_UNKNOWN rejects new Main/Master guidance through the shared target check; archived already-started work retains exact-ID steering.
- Esc and explicit root-card detail hotspots, with consumed-press provenance and geometry/navigation checks. Titles and goals remain selectable; navigation preserves the shared Task draft. Completion inserts quoted titles; `/follow` retains execution-ID semantics.
- Generated contracts/API/docs and the macOS CI suite include #105. Existing manually seeded execution fixtures now allocate rounds and update the TaskPlan in the same transaction.

## Validation and first failures

Raw output remains ignored under `.demo-data/issue105/`. Final exact-HEAD CI and reviewer conclusions will be attached to the PR after code freeze, avoiding documentation-only status commits.

- Initial targeted regression: 261/270 passed. The nine failures identified old fixture clones sharing title/round identity and old grammar/presentation assertions. Fixtures now allocate distinct identities; the underscore title grammar assertion was updated. Production checks were not weakened.
- Initial focused tests: Unicode/admission/continuation passed; legacy terminal fixture required valid terminal fields and READY→RUNNING needed the actual DISPATCHING edge. Fixed fixtures. The first pointer harness needed the real VStack/ScrollView layout; after using the app's layout path, the pinned Pi dispatch test passed.
- `focused-final.log`: 8/8 passed, including title collisions and receipt conflicts, permanent rounds 1–7/recent 5–7, every migration durable boundary with 130 legacy executions, selector ambiguity and archive/guidance boundaries, pre/post-append acknowledgement failures, quoted completion, pinned Pi pointer dispatch, and real TerminalApp click/Esc/rich draft preservation. `focused-final2.log`: 9/9 passed, adding real HTTP lookup/completion scan bounds.
- `regression-fifth.log`: 12/12 passed (TerminalApp navigation, #83 predicates, #92 attention projections). Further legacy state-machine fixture updates use the production `nextExecutionRound` allocator with the counter transaction.
- Type checking, document checks and generated localization passed before full verification. Full `npm run verify` uses a dedicated PostgreSQL cluster on local port 55405 and isolated temporary roots. The first full run exposed another old #16 execution clone fixture; its allocation was corrected. A complete frozen-HEAD rerun and CI are required before final handoff.

## Acceptance boundaries

Native Apple Terminal acceptance is **NOT_TESTED**: the computer-use tool rejected `cua.getApp("Terminal")` with “Computer Use is not allowed to use the app 'com.apple.Terminal' for safety reasons.” No alternative system input route was used to bypass the restriction. Pi/TerminalApp VirtualTerminal coverage is automated, not native acceptance. No additional paid model calls, real-root migration or product acceptance by Master is claimed. The real-root backup/reopen requirement is documented in the API guide. #106 command submission/persistence remains future work.

The same Claude Opus 5.5 Extra conversation will review the exact PR HEAD. Master retains final acceptance and merge authority.
