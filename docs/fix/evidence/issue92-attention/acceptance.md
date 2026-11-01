# Issue #92 acceptance ledger / 验收账本

Date: 2026-11-02. Planning stage only; all product acceptance NOT_TESTED.

| Gate | Status | Evidence / limitation |
| --- | --- | --- |
| Bilingual plan + Claude review | PASS_PLAN_ONLY | R2 PASS; B1–B6 closed, non-blocking notes adopted; source review only |
| Master implementation approval | PENDING | Explicitly required before code changes |
| A1 / AC16 + AC02 | NOT_TESTED | Complete projection, ordering, overflow, archive and read-only exception display |
| A2 / AC17 | NOT_TESTED | Multiline edit/selection, immutable target, rich drafts |
| A3 / AC18 | NOT_TESTED | Directed answer, full authorization/version, APPROVED-before-CONSUMED removal |
| A4 / AC19 + AC24 | NOT_TESTED | Task show, command bypass, literal slash answer |
| A5 / AC34 | NOT_TESTED | Esc, restoration and real terminal key validation |
| A6 / AC20 | NOT_TESTED | Invalid target, surviving errors, same-ID retry and reconnect |
| A7 / AC28 + AC31 | NOT_TESTED | Physical IME/keys; UI-only history/model/retention checks |
| L1–L4 live provider | NOT_TESTED | Mandatory after implementation; no fixtures as substitute |
| Focused + PostgreSQL verify | NOT_TESTED | Product source unchanged at planning time |
| Exact-head Linux/macOS/aggregate CI | NOT_TESTED | Implementation PR not created |
| Claude exact-head implementation review | NOT_TESTED | Same conversation required |
| Master native/manual acceptance | NOT_TESTED | Simulated/PTY keys cannot prove physical IME |
| Master merge authorization | NOT_GRANTED | Plan approval is distinct |
| Merge/post-merge CI/issue closure | NOT_DONE | Separate gates |

AC21/AC29 failure disposition/cancellation remain #93; artifact/image operations remain #94. Seeded UNKNOWN and controlled executor pauses must be labelled separately from real-provider unpaused chains. Preserve first failures, private evidence and exact actual object/request IDs; publish only sanitized summaries.

R2 provenance clarifications: >100-volume, nonempty options/materials, deadlines, authorization display changes and foreign-session records are SEEDED or scripted-provider cases; only actual provider-produced request_decision questions and authorization operations count as LIVE_MODEL. An ended-owner PENDING authorization remains legally decidable but cannot resume that execution. Current Delivery draft wins over an entry snapshot. Process restart does not recover or replay a matter request; in-process retries preserve ID. Failed rows are not removed by newer unrelated executions; #93 owns authoritative disposition linkage.

Final review expectations: active Agent authorization rejection may produce FAILED, whose Main failure row persists; existing-domain historical failure rows are expected. Failure redo/disposition removal is NOT_DELIVERED_BY_92 (#93). Seeded domains must use pump:false/no live credentials; physical IME still NOT_TESTED. No implementation or merge approval inferred from plan PASS.
