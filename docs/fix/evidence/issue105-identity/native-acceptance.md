# #105 native acceptance and completion repair

Master tested the isolated fixture instance at `664c3df43e922a4b033d6b827f2bfcddf145ab40` in a real Terminal. The report is user-supplied native evidence, not an agent-operated native test. Terminal/font/IME details were not supplied.

| Checklist | Master result | Disposition |
| --- | --- | --- |
| A01–A03, A05–A10, A12 | PASS (Master: other items had no problems) | Preserve evidence; no blanket acceptance or merge authorization inferred. |
| A04 | FAIL | `/taskdetail 整` did not complete; `/taskdetail 整理` showed options but arrows dismissed them. |
| A11 | FAIL | `/follow` argument completion did not trigger. |

The new paced-input tests failed before the fix (single CJK prefix; follow trailing space), retaining raw output at ignored `.demo-data/issue105/native-completion-before.log`. The earlier single-event command tests did not reproduce the physical input cadence.

The repair removes syntax-driven picker dismissal and uses the existing version-guarded EditorBridge for scoped regular completion after edits/command-name acceptance/explicit Tab. Arrow selection, Enter/Tab, Esc, IME commits and the actual TerminalApp routing are covered; pasted-slash/wrong-page/stale-response negatives remain protected. No file completion or automatic single-candidate acceptance is introduced.

Initial focused validation: 8/8 passed; typecheck passed. Full final-HEAD validation and Claude review will be appended to the PR without status-only commits. Master must retest A04/A11 on the new version; they remain NOT_ACCEPTED until that feedback. Existing process-recovery flakiness and prior failure logs remain in the PR evidence.

## Retest at d905c5c8 and R6 repair

Master reported A04 PASS and A11 FAIL: paste expansion returned INVALID_DRAFT_RANGES. Subsequent pasted/nonpasted input, undo/retyping and arbitrary task selection all failed. The saved fixture draft contained an out-of-bounds provenance span; original state and an ignored evidence copy are retained.

A real DraftEditor reproduction with a pasted follow argument failed with the exact error before repair. The replacement-length/end-offset confusion in EditorBridge is corrected; validation remains strict. Regressions cover all three commands, empty/nonempty arguments, Tab/Enter, trailing pasted whitespace, undo/restore, clearing and later block paste, plus actual TerminalApp/Core input. The already-corrupt fixture draft will not be silently rewritten: native retest uses a fresh independent draft directory with the same tasks/data. This is not a production draft recovery feature. R5 Shift+Enter documentation is corrected without changing behavior. Final checks/review belong to the PR; A11 remains pending Master.
