# #104 plan review / 计划复核

- Scope / 范围：plan only，Master 批准前不实施；合并另需批准。
- Baseline：`9a8049a42cd7d20f6e928bb699e9e4b9d5b222ea`（#103 / PR #107 merge）。
- Reviewer：Claude Opus 5.5 Extra，提交前已在界面确认；复用 [Master 已打开的会话](https://claude.ai/chat/14cf8a15-0d9c-47eb-897a-c1928865a382)。
- [中文计划](../../fix_20261106_issue104_streaming.md) / [English plan](../../fix_20261106_issue104_streaming.en.md)
- Raw evidence：Git-ignored `.demo-data/issue104/review/`。请求、回复、提交时间、计划快照、源码清单；本文件仅记录脱敏结论。

## R1

Submitted 2026-11-06 21:12:39 HKT; read after the required ten-minute wait, at 21:22 HKT. Verdict: **CHANGES_REQUIRED**.

| Finding | Codex disposition |
| --- | --- |
| Blocking: Pi synthetic failure can inherit the previous onPrepared ModelCall and replace its real message | Accepted: clear token before invocation; only successful save/replay gives one-shot provenance, exact saved-response equality before correlation; synthetic errors retain event IDs. Add explicit pre-onPrepared failure cases after a successful call. |
| Blocking: authorization.prepare also serves session-only World requests | Accepted: new Task Feedback only with valid Task/Execution scope; test session-only World request needing approval. |
| Reuse causation_id/related_object_ids | Accepted: no new journal field/payload wrapper; annotate model.response and proven agent.message. |
| Separate Task SSE from potentially oversized Main frame | Accepted: independent task_transient event, budget and watermark; CJK overflow regression. |
| Do not wake Main for resolved authorization | Accepted: QUEUED→SUPPRESSED with reason/time and null input_id; preserve fact, no fictional delivery; audit terminal-state consumers. |
| Easier return-to-latest and ID completion | Accepted as proposal for Master's approval: /follow selects anchor section or newest displayed execution once and freezes its ID; optional exact ID and off; completion edits only. |
| Existing replay may repeat tool-result events | Documented existing boundary; no heuristic deletion under #104. |

Independent Codex source-audit additions sent with R2:

- Task observation drains provider events to bounded preview; do not retain a second queue of every delta for Agent replay. Return existing done-only savedResponse after durable commit.
- Adding observe must not switch Task's failure behavior into the existing Main-oriented diagnostic stream branch.
- R2 proposed per-decision/result/operation-unknown-event dedupe. Reviewer corrected the hypothetical multiple-episode premise; final contract below uses the existing single execution episode and preserves legacy coverage.
- No runtime PROGRESS producer exists at baseline: preserve old records, avoid speculative data migration.

Reviewer directly inspected listed Secretary baseline files and pinned Pi synthetic-error behavior. It fetched a summary of issue #104, not raw issue text. No tests, provider calls or native terminal checks were run by reviewer. Prior #103 CI was supplied context, not independently verified during this review.

## R2

Submitted 2026-11-06 21:25:09 HKT; observed after the required ten-minute wait at 21:35 HKT. Verdict: **PASS (plan readiness only)**. Both R1 blockers resolved; reviewer independently confirmed the queued-delta and observe-dependent error-path findings. No tests/provider/native checks executed.

Four requested precisions incorporated into both languages before delivery to Master:

1. Notify only while AuthorizationRequest=PENDING/unexpired, Operation=WAIT_AUTH, Execution nonterminal/not cancel_requested. Never require Execution WAIT_AUTH, because a crash after prepare can recover a live wait to READY.
2. Correlation token survives durableStream return and is consumed by message_end; transport finally cannot clear it prematurely.
3. SUPPRESSED is settled in retention.ts, avoiding permanent retirement blockage; terminal-state regression required.
4. Current RESULT_UNKNOWN cannot resume and has only one episode per Execution. One notification covers all affected operations. New identity uses execution + first persisted entering revision, not a nonexistent interruption event; any legacy UNKNOWN already covers the same episode, preventing upgrade duplicates. No new resume/multiple-episode semantics.

Small source corrections accepted: Task already has selectionActive/onViewport; current Task provider already queues events before result(), so bounded observation/done-only replay reduces existing buffering.

Reviewer explicitly classified these as pre-implementation precisions under PASS, not a redesign/new blocker. Final files implement that requested clarification; no independent post-clarification third round is claimed. Master implementation approval is pending. Product code/generated schemas unchanged; #104 product tests, provider calls, native acceptance and CI NOT_RUN.
