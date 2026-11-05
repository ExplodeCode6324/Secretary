# Issue #94 plan review

Base: `578bcc2e9d70726e305ededc4e0fa1a68bef3623`. Scope: plan only; Master's explicit implementation approval is required.

Reviewer: browser Claude, UI verified **Opus 5.5 Extra** before submission. Issue-specific conversation: https://claude.ai/chat/8bc2b4fd-2faa-4f9c-9e75-bf256cc3a91d . Retain this conversation for all subsequent plan/implementation rounds.

Raw English requests, original replies and screenshots: ignored `.demo-data/issue94/review/`.

## R1 — CHANGES_REQUIRED

Sent 2026-11-05 03:28:44 HKT. Full English plan and Chinese counterpart were provided, together with repository, issue, exact-base source-tree, implementation-reference and attachment-contract URLs. Requested source-level feasibility review, substantive bilingual parity, actionable blockers and a plan-only verdict. No implementation or runtime acceptance was claimed.

Review cadence: first response check after ten minutes; if still running, subsequent checks five minutes apart. Waiting time is not approval.

Planning checks: the initial `npm run docs:check` passed for the existing tracked set (667 Markdown files, 8,596 local links), but that checker excludes untracked files. After staging all four new plan/evidence documents, it passed again with 671 Markdown files; 119 sources / 357 localized pages current. Subsequent edits require a final rerun. This does not validate implementation, native Terminal, real-provider integration or CI.


First check at ten minutes found the response running; the five-minute follow-up obtained the final report. Claude independently checked repository HEAD and owning code, pinned Pi agent/editor/native helper code and the published npm Darwin helper. It could only partially read the issue through a summarizing fetch; it used the exact-base implementation reference for AC wording. It ran no tests, native Terminal or real providers.

| Finding | R2 disposition |
| --- | --- |
| B1 message identity / empty and truncated replies | Accept: atomic main.delivery sidecar carrying IDs, unchanged main.message/identity, stop and visibly truncated length outcomes, empty-body display, replay guards and sync invalidation. |
| B2 LaunchServices execution / SSH / invisible paths | Accept: regular-file/no-links/execute-bit checks, explicit document suffix allowlist with no fallback, visible formatting, shared local macOS/non-SSH guard, native negative checks. |
| B3 attachment rejection jams pending | Accept: audit synchronous pre-admission errors, restore complete materials/release pending on definite rejection, preserve unknown identity; all text-only clear/restore guards include images and generation; capabilities preflight. |
| B4 optional explanations / nonexistent canonicalization | Accept semantic requirement; retain artifacts path array with conditionally required description map for new calls, rather than changing its item type. Legacy stored/replayed data remains readable. Explicit dot-segment canonicalization, duplicate/collision refusal and bounds. NFC is comparison-only and cannot rewrite filesystem paths. |
| B5 Finder icon mistaken for real image | Accept risk as unverified native behavior: minimal AppKit type/changeCount probe before/after Pi read; reject actual file references, races and probe failures with zero import. Native cases mandatory. |

Clarifications adopted: RESULT-only delivery sourcing; pure computed current-path view; exact Core path filter/index; completion/attachment focus priority and Backspace/typing rules; whole-command paste and empty-image sending; v3 migration/rollback/collector; five seconds or next-action notice clearing; explicit approval scope for existing models and isolated documented vision profile. Task explanations remain NOT_VERIFIED; background-process finish limitation and Retina size/permission prompts are recorded. English/Chinese parity exceptions were reconciled in favor of #94 owning its required image/path work.

## R2 — CHANGES_REQUIRED (narrow)

Revised full bilingual plan sent in the same conversation at 2026-11-05 03:49:07 HKT (exact UTC timestamp in ignored r2-sent.txt); first read after ten minutes. Safe local preflight found the existing opencode-go deepseek-v4.1-flash / gpt-5.6-luna registry entries list image input; no repository .env or exported vision-budget profile was found. This is not provider execution or proof that all other deployment files lack a profile. The plan makes isolated profile preparation an explicit approval implication and retains a blocked outcome if no defensible provider bound is available.


R2 was read after the ten-minute first wait. Claude rechecked synchronous message/import admission, budget errors, event IDs/commit ordering and pinned Agent.continue behavior; no tests, macOS or provider runs. R1 B1–B5 and clarifications were substantively closed except two narrow blockers. Bilingual parity passed.

| R2 finding | R3 disposition |
| --- | --- |
| R2-1 replay of length without a delivery sidecar | Accept: complete any saved final stop/length assistant response without tool calls, independent of display references; add a no-delivery replay test. |
| R2-2 unspecified compiled clipboard helper | Accept simplification: fixed repository JXA script via built-in osascript/AppKit, shell:false, 3-second timeout, bounded/strict JSON, no native compilation or distribution dependency. |
| C1 import admission errors | Known pre-reservation INVALID_REQUEST / ATTACHMENT_TOO_LARGE / ATTACHMENT_CAPACITY_FULL becomes a failed local attempt with source preserved; unknown transport retains the original identity for reconciliation. |
| C2 incomplete message error list | Include budget-config/image-block errors; derive the complete synchronous table at implementation HEAD and require negative/coverage tests; distinguish schema-before-receipt from domain-after-receipt ordering. |
| C3 text paste wrongly gated by vision | Keep local/SSH guard for all reads; gate only actual image types on Core capabilities. Text-only /paste works disconnected or with no vision profile. |

Residual LaunchServices per-file Open-with/resource-fork association risk is named in both plans for Master's approval; suffix guards are not a sandbox. The acceptance digest mismatch remains harness-only and explicitly injected. No native behavior has been asserted as tested.

## R3 — CHANGES_REQUIRED (scope correction)

Full revised English/Chinese plans and concise R2 dispositions submitted to the same conversation. Implementation approval remains NOT_GRANTED. All runtime/provider/native/CI gates remain NOT_TESTED.

Sent 2026-11-05 04:00:52 HKT; first response read after ten minutes.


R3 was read after the ten-minute wait. Claude confirmed R2-2 and C1–C3 closed, with English/Chinese parity PASS, but retracted its R2-1 recommendation after checking the recorded #80/#81 recovery boundary. Codex independently read those owning repository documents and selected **descope**, not implicit expansion of Master's approval.

R4 removes the proposed general length-replay repair. Keep existing stop-only replay; after the atomic delivery commit, stop recovers normally, while length retains the known RECOVERY_BLOCKED outcome and shows its already-durable delivery once. Test both delivery/no-delivery length boundaries without falsely passing general recovery. No #94 gate requires repairing that #80 follow-up. This supersedes the R3 recovery disposition above.

Also accepted the two wording fixes: each stdout/stderr stream has a 64 KiB cap, and a failed clipboard type probe rejects all of /paste (including text); successful text-only probing remains independent of Core/vision. No new native/provider evidence was claimed.

## R4 — PASS_PLAN_ONLY

Only the recovery descope and those wording fixes changed; complete current bilingual text was supplied to pin the final approval document. Same Claude conversation and verified model.

Sent 2026-11-05 04:11:57 HKT; first response read after ten minutes.


Read after the ten-minute first wait, 2026-11-05 04:22 HKT. Claude returned **PASS_PLAN_ONLY**, expressly stating no further plan review rounds are needed. It compared the complete R3/R4 bilingual text, verified that only declared recovery/wording/status edits changed, re-read the exact-base recovery path and pinned Pi, and confirmed all prior blockers and bilingual parity closed. It executed no tests, native interactions or providers. Raw response and screenshot: ignored r4-response.txt / r4-result.png in the review directory.

Implementation reminders accepted without enlarging scope: compare the persisted-length crash with the same test on unmodified baseline rather than forcing an unexecuted RECOVERY_BLOCKED expectation; record any difference, never modify recovery merely to match the expectation. Repeated /resume must not create a second delivery event. The final implementation review must cover exact HEAD, atomic sidecar/original message identity, rejection-code coverage, v3/legacy-export behavior, bounded clipboard probe and open guards, with clearly attributed native/provider evidence.

Master approval implications are explicit: document suffix/execute-bit opening policy and residual per-file Open-with risk; existing Main/Task models plus a defensible isolated vision profile; 48 Main / 32 Task / 160 tools / 25 active minutes / 8192 output tokens per call; inline draft attachment controls and v3 migration; exclusion of the #80 persisted-length recovery repair. No implementation/live run/merge/issue-closure authorization is inferred from this verdict.

Final plan status headers were updated to the received verdict; substantive R4 plan text is unchanged. Branch: codex/issue94-delivery-plan. Refreshed origin/main remained 578bcc2e9d70726e305ededc4e0fa1a68bef3623. Only the four plan/evidence documents are in this change; product source, tests, dependencies and CI are unchanged. Master implementation approval remains NOT_GRANTED.
