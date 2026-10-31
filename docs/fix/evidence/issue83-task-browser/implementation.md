# Issue #83 implementation and evidence

Master approved R2 on 2026-10-31. The implementation adds the five planned read endpoints and a terminal Task browser. No merge, issue closure or native/manual acceptance is authorized by this record.

## Implemented boundary

- Whole authorized-set membership, global ordering and counts precede cursor paging. Shared uses `shared:null`; named NONE scopes remain ordinary. Scope/Execution creation times come from first journal mutation provenance. Per-task invocation/active/failure facts and proposal data are rebuilt incrementally; checkpoint-only revision churn does not invalidate ordering facts or list cursors. Time predicates run against `as_of`; `valid_until` drives refresh without writes.
- Attention and actionable-failure helpers are shared with existing consumers. PAUSED/CLOSED work cases are explicitly SEEDED tests. Historical search/completion excludes archived collisions and never inflates current counts. Every detail/message/content request rechecks visibility and ownership.
- Only durable `agent.message` events supply up to three execution conversations. Same-text events remain distinct. Actual user, assistant, tool and displayable reasoning content is paginated; redacted reasoning is omitted. Reads neither dispatch models nor mark executions viewed.
- The Task root and details share the existing Task draft. `/search_task`, `/taskdetail`, `/back`, `/M` and `/T` use stable IDs and source anchors. ID completion replaces only the token and rejects stale results. The single Main CoT mode applies to Task. Both pages share two concurrent reads; Task caps 200 message metadata / 4 MiB body and CoT separately from Main.
- Newest-three changes and archive responses remove stale bytes; navigation epochs prevent late reads resurrecting them. Bounded reverse paging retains the newly requested side. Rendering reuses #91 Markdown/source windows and caches components without copying full body text into version keys.

## Validation and first failures

The focused #82/#83/#91 suite passed 120 tests before the final cache/navigation cases were added. The final added projection and window cases passed separately. Full PostgreSQL `npm run verify` and exact-head Linux/macOS CI are recorded in the PR final-head comment, so recording a verdict does not create another unreviewed commit.

Preserved private logs under `.demo-data/issue83/implementation/` include first TypeScript/DTO failures, old page-number assertions, a seeded-contract test setup error, and the reverse-window eviction regression. Assertions were updated for changed product semantics or corrected fixture construction; the reverse paging bug was fixed and now has an explicit advancement assertion. No source failure was normalized away.

[Sanitized live evidence](live-model-summary.json) records opencode-go / deepseek-v4.1-flash: 29 Main calls, 24 Task calls, 80 tools; all transport responses HTTP 200. Limits were registered before freezing model requests. Four real executions give exactly three visible groups. The newest has 66 actual events; final-source verification restores a real Assistant tool-call body of 7,599 characters. Positive displayable reasoning and an actual message without reasoning are both covered.

Two Main-created Shared tasks wrote separate `report.txt` files: 7,452 versus 25 bytes, distinct task cwd and SHA-256. A real missed-AT restart produced PAUSED without an execution. Quiescent browsing changed neither journal sequence nor model-call count; a controlled restart had its own startup journal mutation and did not rerun Agent work or change retention.

R1 genuinely failed at the 4096-token ceiling (`stopReason=length`, fourth Task FAILED). The first report is retained with its hash. R2 used a fresh domain and a preconfigured 8192-token normal/output ceiling; the production budget guard was never weakened. L3 passed only its intended RUNNING/queue/TASK_BUSY observation. Its Agent later reported FAILED because its write finished after the finite deadline; no successful recurring series is claimed, and queued work was not dispatched after capture.

## Native boundary and reproduction

HTTP plus actual recorded-data VirtualTerminal checks passed at 80×24 and 120×40. Native Terminal.app automation was refused by the computer-use tool (`com.apple.Terminal`). Physical Shift+Enter/Tab, native IME candidates, mouse selection and clipboard remain **NOT_TESTED**, pending Master. No browser TUI was used.

For the local preserved R2 domain, use two terminals from the repository root (the evidence-only server disables scheduler pumping and prohibits model calls):

```sh
npx tsx test_case/online/serve-issue83-history.ts .demo-data/issue83/live-r2
```

```sh
SECRETARY_DATA=.demo-data/issue83/live-r2/core npm run tui
```

Then `/T`, `/search_task 9dffed54`, `/taskdetail 9dffed54-37e2-4f17-966a-1cc69750e76b`, `/back`; toggle CoT only from Main. The rich Task draft must survive navigation and must never be sent. Exit each terminal with Ctrl+C. This local data is Git-ignored and contains only this isolated acceptance task.

AC33 remains partial: separate Shared cwd is verified; artifact listing, registered-only delivery, open/image UI belong to #94. #92 attention actions and #93 cancellation/failure disposition remain outside this change.
