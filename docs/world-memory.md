# World memory

WorldEntity, WorldAssertion and WorldGenesis live in the Core journal and CAS. The replayed Store is the only current authority. PostgreSQL `mem` is a rebuildable conversation-search index; old `wm` tables and historical contracts are retained for import and audit.

## Writes and approval

Main uses `memory_propose_change` with one `changes` array of 1–20 edits. A batch may create a person using `local_ref: "$alice"`, then ASSERT a fact whose subject is `$alice`. Edits include CREATE_ENTITY, EDIT_ENTITY, RETIRE_ENTITY, ASSERT, CORRECT and RETRACT. Model evidence refers to real current-session events; owner edits use an authenticated request event. Approval never promotes inference to Master evidence.

Each model batch requires a fresh exact-parameter grant, expiring after 24 hours. Remembered/wildcard World rules remain inert. The approval detail shows evidence quotes, current aliases, existing LIVE facts, conflict consequences and a preview timestamp. Application revalidates all members, provenance, targets and owner epoch immediately before one synchronous journal commit. Invalid members cannot partially apply. The frame consumes the grant and writes World records, a successful Operation and its receipt. It never enters external DISPATCHED/RESULT_UNKNOWN states.

ASSERT preserves existing facts. CORRECT explicitly names a LIVE target and creates its replacement while superseding the target. RETRACT preserves the old assertion body. Names use a from/to stale-base check; aliases use add/remove sets. Opposite alias decisions apply in durable approval order. Role entities cannot retire or change kind, role, external key or identity. Secretary's display name comes from AssistantProfile and updates atomically.

Owner clients use `POST /api/v1/world/changes` with request_id and changes. Settings rejects nonempty World edits/command_ids. World success, rejection, revocation, expiry and application failure do not wake Main or rebuild Consciousness. Main must use `memory_read source=world_batch, batch_id=...` and confirm COMMITTED before claiming a fact was recorded. Owner clients query `world/batches/{batch_id}` or the associated Operation.

## Reads, profiles and recall

Selectors accept entity IDs, names, aliases, `role:master` and `role:secretary`. Ambiguous names return candidates. `memory_read source=world` accepts subject, predicate, topic, fact_id, history and catalog (entities/roles/predicates). Keyset cursors are scoped and validated; pagination is a moving view, not a snapshot. `person.height` and `person.display_name` are retired for new assertions; explicit historical reads and retraction remain available.

`entity.guideline` is limited to role anchors with genuine Master evidence. Other facts are descriptive data. The shared Main assembler orders BASE_SYSTEM, verbatim UserInstructions once, deterministic role profiles, Scope, conditional failure instructions and recall data. Derived Master/Secretary caps are 40 rows/3 KiB and 20 rows/1.5 KiB; contacts and free notes are not resident. Profiles and recall are not copied into Task packets. Main freezes system text and recall diagnostics when claiming a batch; continuations/recovery reuse that snapshot.

Recall normalizes NFKC names/aliases, Latin words and Chinese bigrams, uses bilingual predicate labels and approved keywords, ranks source and freshness, and expands at most 20 one-hop membership/dependency relations. It excludes retired, superseded, retracted, out-of-validity and fully withdrawn evidence. Explicit reads retain evidence-withdrawal flags. Conflict groups are shown whole or omitted with a read pointer. The automatic cap is 12 rows/1.5 KiB, at most five rows per entity. Full statements preserve negation. No-hit is not proof of absence; unavailable means World initialization has not completed.

`SECRETARY_WORLD_PROFILE=off|on` defaults to on; `SECRETARY_WORLD_RECALL=off|shadow|on` defaults to shadow. Shadow records diagnostics without injecting facts. These flags and changing facts do not alter the Settings runtime fingerprint. `POST world/preview` accepts `{text}` and returns recall without a request_id, writes or model calls. Fact search uses `memory_search kinds:["fact"]`; log search remains PostgreSQL-dependent.

## Upgrade and recovery

Finish all legacy World commands, Settings applications and unexported outbox rows using the original runtime. Back up the full domain, database, configuration and external task roots. New startup performs the idle/Settings preflight before World records and reads every legacy table in one read-only REPEATABLE READ snapshot. The original rows live in a CAS manifest. Validated entities/assertions retain their IDs and historical status; roles and genesis are committed in one frame. Unknown schemas, foreign evidence, role conflicts and incomplete exports stop import. PostgreSQL failure never implies an empty database.

Fresh domains are explicitly identified and schema absence is checked when PostgreSQL is configured. `initializeMemorySearchSchema` runs only `src/schema/memory_search.sql`; it never replays historical World migrations. Once genesis exists, PostgreSQL outages affect log search, not World facts.

Existing sessions queue the normal one-time runtime Settings activation. Main and new Task claims wait for APPLIED; status and recovery remain available. Ordinary later World writes do not queue another activation. The first new World record/prompt snapshot is an old-reader boundary. Restore or rollback must not discard newer writes: use a compatible forward repair after that boundary.

Scope import and Shared workspace changes remain separately tracked in #113 and #114. The journal_apply edge rejects external actions; scope.import remains closed until its own exact frame validator is implemented.
