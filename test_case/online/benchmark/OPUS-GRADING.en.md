# Opus grading and private report replay

The current default is **Opus 5.5 Extra**, in a fresh Manual / Incognito browser context for every batch. The benchmark deliverable is an executable, traceable workflow with reproducible accepted-input reports. Secretary performance qualification, severity adjudication and thresholds remain separate and do not block harness delivery. No command below starts a SUT or changes a deployment.

The frozen browser contract is still named `opus-5.5-extra-migration-v1`. This is a contract identifier, not evidence that every new run was migrated. Fresh exports build the historical V3 batch in memory, apply the exact accepted Opus derivation, and publish only the Opus request. The local `secretary-opus-assessment-v1` store records FRESH_OPUS versus HISTORICAL_FABLE_REASSESSMENT. Rubric V3, controls, evidence and old labels are not rewritten. Old readers remain available; the CLI does not create sendable Fable batches or accept new single-packet Fable grades.

## Prepare and review

All inputs/observations must be private owned files under this checkout's `.local/reviews/` or the facility's `oracles/`. Keep files 0600 and directories 0700. Do not put Finder/OS metadata in oracle trees. Use only stopped owned facilities; each mutation holds the existing controller lease. Unknown ownership fails closed. The assessment-only process probe recognizes a positively identified later process at a reused historical group-leader PID; it never sends a signal and does not change product lifecycle guards.

For fresh runs, freeze their dispositions and source packets through the existing `memory-grade-disposition` and `memory-grade-export` commands. The latter returns `sendable:false`: this is a local evidence source, not a browser request. Put the following in a private source file:

```json
{"runs":["<run UUID>"],"cohort":"CURRENT_DEVELOPMENT","anchor_relative":"docs/fix/evidence/<cohort>-opus-anchor.json"}
```

Then use:

```sh
npm run benchmark -- memory-assessment-plan --root <facility> --source <source.json>
npm run benchmark -- memory-assessment-prepare --root <owned-evidence-copy> --source <returned-plan-file> --batch <assessment-id>
```

Preparation is pure with respect to the source facility and writes only a private preparation artifact. It returns record, request and preparation hashes. Multi-batch reassessments use the same versioned worklist format: one row per original run, selecting ASSESSMENT, an already accepted MIGRATION receipt, or a proven HOST_ONLY exclusion. Every row binds packet, original artifact, run metadata and cohort. Reassessment parents must be accepted Fable V3 batches, with the exact original mapping and derivation contract. Do not manually change the historical packet or private control key.

Before actual exports, freeze the entire worklist, history inventory and all request/preparation hashes. Commit an opaque `secretary-opus-assessment-anchor-v1` containing `worklist_sha256`, `history_sha256`, and `entries` with `assessment_id`, `record_sha256`, `request_sha256`, `preparation_sha256`. Obtain exact-HEAD implementation review and required CI, then save a private `secretary-assessment-execution-proof-v1` with `head`, `review_status:PASS`, `ci_status:PASS`, `review_sha256` and `ci_url`. These are trusted operator attestations, not cryptographic proof of remote review/model identity. Any later source commit needs a newly reviewed context.

```sh
npm run benchmark -- memory-grade-batch-export --root <facility> --source <plan-file> --batch <assessment-id> --approval <proof.json>
```

`memory-assessment-export` is the same operation. The export must reproduce the owned-copy preparation bytes under the lease. Upload **only the returned request.txt**, with the unchanged wrapper exported by `grading-attempt.ts`. Never upload plan/private/preparation/history files or hidden control mappings to the judge.

## Dispatch and collect

Save a browser observation containing `model:"Opus 5.5"`, `effort:"Extra"`, `mode:"Manual"`, `incognito:true`, `session_url`, and `files` pointing to saved UI evidence. Reserve before sending; record send intent immediately before the browser action.

```sh
npm run benchmark -- memory-assessment-reserve --root <facility> --batch <id> --source <ui.json> --approval <proof.json>
npm run benchmark -- memory-assessment-send --root <facility> --batch <id> --attempt <attempt-id>
npm run benchmark -- memory-assessment-import --root <facility> --batch <id> --attempt <attempt-id> --verdict <original-copy.txt> --source <extraction.json>
```

Extraction records `copy_matches_display:true`, `in_flight:false`, `completed:true` (or confirmed transport truncation) and saved evidence `files`. Preserve the original Copy text. Only outer whitespace and one outer JSON Markdown fence may be removed; no repairs, concatenation, continuation requests or partial imports.

Every reservation counts, at most three. Only confirmed transport-with-no-response or unparseable JSON permits the identical complete request again. Identity/schema/hash/eligibility/control failures are terminal. `memory-assessment-no-response` requires `confirmed_no_response:true`, `in_flight:false`, `failure_kind:"CONFIRMED_TRANSPORT_NO_RESPONSE"` and UI evidence. Accepted results cannot be replaced or resent. Quota pauses preserve the current attempt. Calibration failure or exhaustion pauses grading; regrouping requires a separately reviewed rule. Four-trajectory historical groupings have a length risk. Report semantic contradictions or projection asymmetry as measurement limitations, without changing labels or creating an unbounded performance review.

Interrupted transactions, uncertain response capture and quarantined assessment attempts pause and preserve evidence. Existing `memory-judge-inspect` / `memory-judge-reconcile` remain the transaction inspection tools; quarantine does not authorize a model retry. Some interrupted states deliberately have no automatic recovery. Receipts rely on a trusted local operator and local time. Never remove journals or overwrite sources to make a run pass.

## Deterministic private replay

Save `{worklist,locations:[{facility_nonce,root}]}` privately and snapshot the full retained input set:

```sh
npm run benchmark -- memory-assessment-snapshot --root <facility> --source <snapshot-source.json>
npm run benchmark -- memory-assessment-replay --root <facility> --source <returned-manifest> --sha256 <returned-sha256> --config <locations.json>
```

Replay verifies all input hashes and the exact file set before computing, and checks the set again before returning. It verifies code HEAD/file hashes and both old migration and new assessment chains. The output has no current timestamp; repeated replay of the same inputs must have the same content hash. New receipts require a new snapshot, never replacement of an old manifest. Relocation uses a separate locations file; the original manifest and result remain unchanged. Replay requires no browser, credentials, network or model request. Inputs are private and retained after delivery. Before releasing archived originals, restore the verified tar archive and demonstrate replay from that copy.

`secretary-opus-selected-report-v1` selects one Opus result per eligible run, with explicit unassessed and host-only rows. No Fable fallback. Coverage totals are not quality rates. Groups include cohort, model, family, profile, case, protocol and provenance; no cross-cohort performance aggregate. S1/S2 remain advisory until human qualification. New LLM/SUT execution is not promised deterministic.

Historical limits remain: partial effect observability; World host-marker gaps (frozen positive coverage 0/3 in this pilot); omitted cold-context evidence; development exposure, correlated samples and incomplete blinding. For runs `5b45b761` and `d0de3a9b`, the private `r11-shell-constraint-casebook.json` retains independent no-shell/effect receipts; judge prose describing permission cannot override them. No thresholds, RC98304, new SUT campaign, V4, merge or deployment is implied.

The public QA default is separately named `secretary-public-qa-opus-variant-v1`. It preserves pinned upstream templates and parser, stores old variants separately, and requires its own QA controls before any result is used. **NOT_EXERCISED / NOT_CALIBRATED** for real Opus QA in this delivery; official public accuracy remains NOT_TESTED. Memory controls do not qualify public QA, and results are not pooled with historical Fable variants.
