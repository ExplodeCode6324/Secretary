# Issue #91 acceptance registration

Date: 2026-10-30 (Asia/Hong_Kong). Implementation checkpoint. Detailed measured results and limitations: [implementation review](implementation-review.md). Master approved §13 and its replacement passes the registered source/render properties. Final HEAD/CI/Claude results are recorded on the implementation PR; this is not Master product acceptance.

| Parameter | Planned value / registration |
| --- | --- |
| Base | 9324283c58f65cc5d783d0f3a33f79ca14575689 |
| Tested implementation SHA | Final implementation SHA and check results recorded on PR; base and historical runs distinguished below |
| Pi | @earendil-works/pi-tui 0.87.0; upstream 16787ad5b2dc748047f314ca1bfe7708f30f54f3 |
| Node/macOS/Terminal/font/input method | Node v22.22.0 / ICU78.2; POSIX PTY80x24; physical Terminal/font/IME NOT_TESTED |
| Minimum / larger native size | Proposed 80 columns × 24 rows / 120 × 40; NOT_TESTED |
| Keys | Enter newline; Shift+Enter explicit submit; completion first; Ctrl+C client exit; Up from first visual input row to viewing; Up/Down scroll; Escape editor; actual paste key NOT_TESTED |
| N / B / H | 50 initial items / 50 per request / 200 resident metadata items, activities included |
| Text residency | 4 MiB UTF-8 body/CoT; whole-message assembly only up to 1 MiB within shared budget, otherwise complete-block windows targeting 8 fragments, <=1 MiB source per region, bounded contexts; not total browse limits |
| Anchor | ID + region + source block UTF-16 offset + row in block + measured width + instance/generation/revision |
| Error dismissal | Next deliberate edit, valid command or navigation; passive redraw does not clear |
| Live run budget | ≤12 physical provider HTTP attempts including retries, ≤15 min, ≤90 s/request, ≤4096 output tokens/response |
| Paste behavior approval | MASTER_APPROVED B: <=30 graphemes, LF/TAB-free single line inline; otherwise owned block (R3 corrections adopted) |
| Display line count | Logical LF-split lines including trailing empty line: a\nb\n = 3; singular “1 line” |
| Large draft diagnostics | Isolated 1 MiB / 16 MiB synthetic Main/Task drafts; input-to-visible, serialization/save durations; not new quotas and no oversized POST |
| Raw evidence | .demo-data/issue91/ (Git ignored); no credentials in committed records |

| Gate | Status | Evidence required |
| --- | --- | --- |
| AC07 initial/page/evict/re-read/long body | AUTOMATED_PASS; §13 parity/real-Core measurements PASS; native pending | Ordered IDs/content anchors; retained counters/heap observations before/after >H and reverse |
| AC05 Main / AC03 CoT | AUTOMATED + PTY/SCRIPTED_LIVE_PASS; physical native pending | Present/absent, summary, new/backfilled, both spellings, native gray rendering |
| AC06 anchor/mode cursor/no writes | AUTOMATED + PTY/SCRIPTED_LIVE_PASS | Source-block/row anchors and authoritative quiet-session boundary comparison |
| AC08 all three no-follow cases | PTY middle + SCRIPTED_LIVE bottom/Task-return PASS | Native middle/away/latest, edited draft/cursor retained |
| AC09 failed read and cursor recovery | AUTOMATED_REAL_CORE_PASS; native pending | Original failure, local error clear, same-position resumed traversal |
| AC27 native multi-paste | NOT_TESTED | Actual clipboard paste, block summaries, exact normalized Core/provider payload |
| Pi raw/trim/paste lifecycle | AUTOMATED_PASS + L4 real-provider replay PASS | Provenance, split paste, undo, leading space, rawmessage, reopen, same-ID failure recovery |
| Rich editor feasibility | FOCUSED_TESTS_PASS; native NOT_TESTED | Word scan owns whitespace; both delete directions around tokens; undo pop alignment; kill accumulate/prepend; duplicate yank; token-adjacent <, >, paste and IME-committed text |
| Running multi-fragment CJK | REAL_CORE_FIXTURE_PASS; live oversized NOT_TESTED | Fixture + real Core only unless actual live bytes prove coverage; no stale-cursor error on normal delta supersession |
| Preview discovery and order | AUTOMATED_REAL_CORE_PASS | SSE previews[].id; brand-new preview NOT_FOUND means not-yet-visible; new tail rows via direction=after, known refresh via around limit=1 |
| AC24/31 delivered branches | AUTOMATED_PASS; quiet scripted-live cursor unchanged | Command scope/completion/help; no UI-triggered history/model writes |
| Automated targeted and full verification | Full792 PASS; final type/docs and focused checks recorded on PR; historical full783 and focused63 kept separately | First failure and final results, isolated correct PostgreSQL account |
| L1 real model paste send and independent answer check | PASS_PTY; physical clipboard NOT_TESTED | Provider/model provenance, actual traffic, Core input and deterministic oracle |
| L2 real stream and no-follow | PASS_PTY middle + PASS_SCRIPTED_LIVE bottom/Task-return; physical GUI pending | Native operations against real provider |
| L3 real response historical/body/CoT reads | PASS_PTY incl positive provider-exposed CoT | Real message ID, content and availability; positive live-CoT separately labelled |
| L4 real send lost receipt, same-ID replay | PASS_SCRIPTED_LIVE: two POSTs / one Input / attempts5→5 | Script drives actual TerminalApp/Core/provider; transport status failures through retry precheck; two same-ID POSTs reach Core, one Input, no replay-induced provider attempt; late acceptance alone does not pass this row |
| CI on implementation HEAD | NOT_TESTED | Linux, macOS and aggregate required checks |
| Claude implementation review on HEAD | NOT_TESTED | Same session, exact SHA, evidence limitations |
| Master product acceptance / merge authorization | NOT_GRANTED | Separate decisions |

Task CoT inheritance is #83; full AC05 cannot pass in this issue. #92 processing-mode command blocking, #94 images and other later-batch rows are not accepted here. Fixtures, real Core fixture routing, real provider traffic, native input and reviewer source inspection are separate evidence types.

R2 Claude plan PASS is recorded separately in plan-review.md. No overall product PASS. Apple Terminal automation was denied by the tool; L1/L2/L3 used actual ProcessTerminal in a POSIX PTY and are not physical clipboard/GUI evidence. L4 is labelled script-driven live integration. Master/human system IME acceptance remains separate.


### R5/R6 handoff amendments

R5 was CHANGES_REQUIRED at `4d7ad6f`; see the [correction record](implementation-review.md#r5-findings-and-r6-corrections). The revised focused suite passes 69/69. The 4 MiB ceiling remains hard; visible-only pressure leaves stable, explicitly rehydratable placeholders rather than a reload loop. Final exact-head CI/Claude disposition belongs to PR #96.

Master still needs to explicitly acknowledge two non-blocking limitations at acceptance: exceptional formatting can continue after the oversized non-code block through the remaining region; accepting a send clears Main undo/kill history including newer in-flight draft undo steps, without removing that draft's text. These are not recorded as approved or product-accepted.



### R7/R8 strict-format correction

R7 was CHANGES_REQUIRED on `2c32bfb` despite passing CI and 71 focused tests. R8 keeps §13 strict ordinary-path parity using preserved parsed blocks plus region-wide math position and complete reference context. The extra-blank-row exception proposal was withdrawn without assuming approval. See bilingual plan §14 and the implementation-review record for exact coverage and limitations; final CI/Claude status belongs to PR #96. No product acceptance or merge permission is inferred.

R9 adds a no-missing-text gate for non-verbatim Pi token.raw, including duplicate definitions and `$$$$`. Fallback windows retain Pi rendering/global math context but use a window-start anchor. Early unlocatable raw may enter the existing explicitly labelled exceptional-format path; this case is now included in the exceptional-format limitation awaiting Master acknowledgment. It is not silently counted as strict ordinary formatting parity. Exact-head final CI/review remains recorded on PR #96.
