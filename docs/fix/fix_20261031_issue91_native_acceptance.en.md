# Issue #91 native acceptance follow-up

Base: `9cff892444af46e5c0030b96c8b48b114baa07d7`, PR #96. Master reported manual items 1–7 PASS and item 8 FAIL. This follow-up does not grant merge permission. Review stays in the same Claude Opus 5.5 Extra conversation.

## Evidence and scope

The restored draft was accepted by Core. The isolated harness ledger reached its 12 physical HTTP attempt limit; the next model invocation returned `Connection error.` without a physical attempt. Two subsequent Inputs were accepted and remained queued. This is a bounded-harness/model failure, not evidence of damaged draft restoration. Preserve the original ledger, drafts and failure snapshots. Do not reset its counter, relabel the failed run, or automatically replay its queued work. Reproduce graceful exit/reopen and exact rich-draft submission against a fresh bounded server; check a subsequent new message as well. Keep business receipt acceptance separate from model completion. No Core recovery semantic change is planned without a separate demonstrated production defect.

Master also requested follow-to-latest after sending a new message and working text copy. These explicitly amend the old unconditional no-follow requirement.

## Behavior

1. Only an explicit Main message POST starts follow mode. Jump to the latest timeline window, then follow streamed/final reply growth. Do not initiate follow from reconnect, accepted-receipt reconciliation, passive events, local commands, or Task text. Invalid/blocked submissions that do not POST do not move the viewport.
2. Explicit reading/navigation (Up/Down viewing, mouse wheel, beginning selection) or switching to Task ends follow. It does not restart merely because the reader reaches the bottom or returns to Main. Another explicit Main send can start it again. Draft/cursor remain unchanged. Cancelled or stale asynchronous latest-window reads must not overwrite a newly selected reading window. Retain 50/200/4MiB residency limits and existing body paging.
3. Reuse Pi 0.87 selection and drag-to-copy; supply a real system-clipboard callback. On supported local macOS, pipe selected text to `/usr/bin/pbcopy` with no shell and a bounded timeout; only exit success reports success. Clipboard failures or unsupported platforms display an honest error rather than an unverified OSC52 success. Keep Ctrl+C as client exit. Do not modify Pi/node_modules or add a clipboard dependency. Native mouse selection/clipboard round-trip remains Master's acceptance gate; scripted callback tests are not physical proof.
4. Improve bounded live-harness failure evidence to explicitly retain budget rejection reason; do not weaken or silently reset limits. Use a fresh directory and separate ledger for the recovery retest. No new arbitrary product quotas.

## Validation and delivery

- Regression tests: restored rich draft and subsequent new send; explicit-send follows streaming growth and latest history beyond resident range; keyboard/mouse/Task cancellation; delayed latest query cannot undo cancellation; passive/reconciled events do not start follow; clipboard success/failure/timeout and exact selected UTF-8 payload.
- Typecheck, docs check, #82/#91 focused suite and exact-head CI. Preserve first failing regression output. Run a fresh bounded actual-provider reopen/send/new-send test, separately labelled from virtual-terminal and native evidence.
- Update bilingual #91 behavior/acceptance documentation, submit exact implementation HEAD and evidence to the same Claude, then give Master a fresh native retest instance and the remaining manual steps. Do not merge without explicit authority.

## R11 plan review disposition (2026-10-31)

Claude returned CHANGES_REQUIRED, confirming both causes and requesting five concrete additions; it expects readiness after incorporating them without another full planning round. All five are adopted; implementation review will cover the exact new HEAD.

- Follow is application-owned in `AnchoredScroll`; Pi remains `follow: none`. Reader-originated `scrollBy`, `scrollTo`, `scrollToStart`, and `scrollToEnd` cancel it; internal layout restoration uses superclass calls. PageUp/PageDown, scrollbar click/drag and selection auto-scroll are covered. Document mouse presses and a non-empty Pi selection cancel follow. While selected, retain the displayed document rows at the same width so background body changes cannot shift the copy target. Follow takes precedence over anchor restoration, and the logical history anchor tracks the tail.
- While following, the tail message's body and visible thinking use the existing `MAX_SAFE_INTEGER` end target, including running-preview settlement and an already cached first window. A cancelled follow invalidates its in-flight body read. Add >1 MiB end-window coverage.
- Retain the bounded `/usr/bin/pbcopy` approach: explicit UTF-8 child locale, stdin error handling, process kill on timeout, only exit 0 succeeds, serialize copy jobs, and reject SSH sessions. The copy oracle is Pi's displayed selection (rendered Markdown, soft wraps as line breaks, trailing padding removed), not raw Markdown or hidden rich-paste payloads. Copy on mouse release; Terminal's own copy shortcut does not own Pi selection; Ctrl+C exits.
- The failed domain stays stopped, with its queued Inputs intact. Both the scripted fresh recovery run and fresh native retest have separate ledgers and each retains caps of 12 physical attempts, 15 minutes from first provider attempt, 90 seconds/request, 4096 output tokens. Budget rejection is recorded separately from transport errors. Initial baseline recovery repro passed with 2 HTTP200 requests; its first synthetic-driver newline error was preserved and corrected before any model call.
- Update both original plans' §1/§4/AC08 to distinguish explicit POST following from passive no-follow. Explicit same-ID retry counts as a send. Active follow survives resize, reconnect/relocation and `/cotv`; these never start it. Definitive Core input rejection ends it. Follow remains active after reply completion, covering later output, until reader navigation, selection or Task navigation.
