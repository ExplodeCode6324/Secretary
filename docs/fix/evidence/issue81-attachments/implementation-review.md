# Issue #81 implementation evidence

Status: implementation prepared for exact-HEAD review. Coordinator approval is recorded in the bilingual plan, section 10. PR/CI/reviewer final results will be attached to the PR after code freeze. No merge authorization is implied.

## Implemented contract

- Import has its own durable reservation/identity ledger and worker. Original PNG/JPEG bytes are bounded, fully decoded, stored in CAS, and retained after source deletion. Uncertain CAS/journal IO stays QUEUED with the original reservation; generic startup cannot convert imports to UNKNOWN.
- Ordered immutable Input bindings, attachment-only messages, deployment-specific vision profiles, exact installed Completions/Responses payload checks, and reference-based aggregate evidence cover admission through restart/replay. Pure-text keys and budget policy serialization retain their existing shape.
- HANDLED images become authenticated metadata on a fresh loop (K=0); the active loop and frozen transport requests retain pixels. Crop mappings retain the current authenticated form instead of resurrecting an older full image.
- Owner withdrawal is one journal frame, limited to idle, effect-free acceptance/blocked handling. Historical rows retain withdrawal status. Summary/extraction/settings publication, search query/catch-up and World evidence reject withdrawn material.
- Four new operations make 86 total: 52 GET and 34 POST. New TUI consumers remain zero; the full method/path inventory and reasons are in [API coverage](../../../tui/api-coverage.md). No GUI or terminal workflow is included.

## Verification and first failures

The isolated macOS suite `npx tsx --test --test-concurrency=1 test_case/offline/issue81/*.test.ts` passed **30/30**, with a separately created loopback PostgreSQL instance. It covers real sharp decoding; Chinese/metacharacter/ancestor-symlink paths; FIFO/device/permission/mutation failures; quota lowering and duplicate identities; injected CAS/journal failures; actual process SIGKILL boundaries; unavailable/corrupt CAS; guarded atomic withdrawal; pending extraction rejection; full-to-stub authentication and pre-transition crop mapping; fifty image turns with compaction/settings/search; lagging search suppression and SQL tombstones; mixed/image-only World provenance; authenticated binary HTTP; both actual installed adapters through loopback HTTP; both `resume.request` and `last.request` hydration readers; image wire/profile/capacity guards; bounded aggregate storage.

TypeScript checks pass. Generated schema/DTO/OpenAPI/localization and the full `npm run verify` run are required again at the frozen code. Linux CI runs the full suite with PostgreSQL; macOS CI runs the import/input/API/provider/process-recovery suites without a database dependency. Real provider recognition remains **NOT_TESTED**; the 8192-token ceiling is synthetic fixture policy only. Real profile selection and bounded live smoke belong to #84 before human experience acceptance.

First failures are retained in ignored `.demo-data/issue81-attachments/implementation/` logs:

| Evidence | Finding and disposition |
| --- | --- |
| `issue81-01.log` | Agent created an empty error response before an attachment preflight failure, making safe withdrawal unavailable. Run the initial attachment preflight at the Host boundary before Agent output. |
| `regression-01.log` | Old unsupported-image error assertion, operation ordering, and optional capability DTO typing were inconsistent with the new contract; corrected assertion/order/schema typing. |
| `recovery-02.log` | Withdrawal crash fixture reopened with a different model context window and activated unrelated settings rebuild. Reopen the identical fixture deployment; no #80 recovery policy was changed. |
| `boundaries-02.log` | Repeated JS image-object aliases caused evidence dehydration to overwrite a leaf twice. Clone the actual JSON representation; both adapter/replay tests now pass with repeated image content. |
| `verify-01.log` | Legacy transition fixtures assumed all Inputs were text-only and only four state machines existed. Retain the text-only transition matrix, test attachment withdrawal separately, and include AttachmentImport in the inventory. |

An additional source audit found a pre-HANDLED crop mapping could restore a full image into a stub checkpoint. The mapping now authenticates ordered occurrences and preserves each current form; a dedicated regression verifies no pixel resurrection and rejection of forged content. Raw logs remain local, including intermediate compile failures and reruns.

## Identity/equality audit

| Consumer | Authority and retained exact comparisons |
| --- | --- |
| input-projection | Authenticate event and snapshot forms, use original typed text for quotes, bind Settings source boundary; receipt/policy hashes remain exact immutable objects. |
| context-projection / assembly | Versioned crop mappings pair authenticated occurrence keys and retain target forms. Legacy mappings cannot transform attachment messages. Exact JSON remains only for legacy text prefix/header ownership and same-form candidate no-op detection. |
| settings-memory / settings | Authenticated keys pair full/stub occurrences; raw hashes remain same-form legacy aliases. Freeze original evidence and boundary; summaries receive uninspected metadata and extraction receives only original typed text. Publication rechecks withdrawn events. |
| historical-inputs | Wrapper ownership and subset comparisons stay exact CAS/anchor equality. Attachment anchors additionally authenticate their frozen source boundary. |
| memory / extraction-identity | Commitment source refs and batch descriptors remain exact objects; cross-form event/snapshot pairs use authenticated keys and typed-text quote checks. Snapshot alias hashes retain only exact-form compatibility. |
| transport | Request logical identity and payload hashes are intentionally exact and form-sensitive; both frozen reader paths hydrate and verify the same original JSON. |

No shared processes/configuration or inherited 393 untracked files were changed. No real provider, Portable, Band, TUI implementation, general CAS GC or #80 recovery repair is included.

## 12. Coordinator clarification after I1 (2026-10-24)

I1 returned CHANGES_REQUIRED for `1c5b9448817281c85500d91f7930a49ca2bfd94e`; the coordinator confirmed both blockers and withheld merge authorization. Claude corrected its R2 premise: HTTP 4xx produces a FAILED call with a saved empty error response and an empty Agent diagnostic, not “FAILED with no response”. The coordinator explicitly approved this refinement of R3:

- Freeze the Settings source boundary whenever attachment anchors are retained; continue text and compact again after repeated settings, with search ready and not ready.
- Within all existing safety gates, only FAILED/INTERRUPTED diagnostics with stopReason error/aborted, exactly empty text/thinking (no trim), and no tool/unknown content blocks count as non-output. Omit only that loop's verified trailing empty diagnostics from the new checkpoint; retain original response/call/journal/events. Never rewrite call state or claim no provider execution/billing. IN_FLIGHT, RESPONSE_SAVED, real whitespace/text/thinking, tools and Operation effects remain unsafe. Test installed adapter→loopback 400→withdraw→queued text, partial text/thinking/tools, repeated empty failures and atomic crash/idempotency.
- Approve stable stubs/notices, invalidation-aware immutable-reference indexes, structural list availability with its verification level documented, 3–5 MiB noisy-image tests, capacity revalidation matching actual residency/next batch, authentication of a handled full form from its immutable owning message before stubbing, original raw text-only covered_message_hashes and original timeline row revision semantics. Caches cannot bypass authentication or hide corruption/withdrawal.
- MPF/HDR gain-map JPEG remains unsupported; document and hand off to #83/#84, without adding format conversion. Require new exact-HEAD same-session Claude review, targeted/full checks and fresh CI. Merge still needs separate coordinator authorization.

I1 first failures are preserved as `i1-history-first-failure.log` and `i1-provider-first-failure.log`; the latter reproduces both installed adapters. The original HEAD passed local verify 712/712 and CI Linux 711 pass/1 macOS-only skip, macOS 141/141, run 39995351945. Those green checks did not cover the two newly reproduced paths.

## I1 disposition and I2 submission

All I1 findings are accepted within the coordinator's explicit clarification above. The updated attachment suite passed **45/45** (`i1-issue81-final.log`). Two additional fixture assertions initially failed because the synthetic failure did not automatically opt into a retry on new input; the crash fixture now uses the existing explicit `Host.resume()` path. `i1-repeat-recovery-05.log` verifies both crash boundaries with repeated empty failures and unchanged call revisions/responses plus retained diagnostic event IDs. No production recovery policy was changed.

| I1 item | Change / evidence |
| --- | --- |
| Missing Settings boundary | Include the boundary when HANDLED attachment anchors exist, even if all image source messages are already covered. PostgreSQL history test now continues text and compacts after the second application; a separate no-search 3–5 MiB noisy-image test covers the same lifecycle. |
| Provider rejection dead end | Strict empty diagnostic classifier; only FAILED/INTERRUPTED error/aborted with exactly empty text/thinking and no extra content fields qualify. Filter only the abandoned loop's trailing diagnostics in the new checkpoint. Actual installed Completions/Responses HTTP 400 tests withdraw and run queued text. Partial/whitespace text/thinking, tools, unknown blocks, IN_FLIGHT and RESPONSE_SAVED all refuse. Original audit records remain. |
| Stub churn | Reuse authenticated stub/notice objects; the successive-loop test asserts exact equality. |
| Repeated scans | Per-Store journal-sequence index stores immutable accepted-event/frame references and owning-message hashes; new committed frames extend it. Use eventById. Authentication still checks the current Input/withdrawal state, boundaries, actual message digest, typed text and ordered image hashes; no cached binary-integrity verdict. |
| List hashing | Timeline/conversation metadata uses lstat type/length checks. Explicit metadata/content, admission and dispatch retain full integrity checks. The guide distinguishes these verification levels; API test asserts timeline performs zero image-byte reads. |
| Realistic bytes | A random RGB PNG exceeds 3 MiB and remains below 5 MiB; it traverses handling, settings, text, compaction, second settings and more text without base64 summary text or pixel resurrection. |
| Capacity revalidation | Apply fresh-loop K=0 and the same next-batch isolation as dispatch. A handled image plus five queued image Inputs clears a stale capacity block without combining all five. |
| Handled full-form corruption | A HANDLED full form can authenticate from its immutable owning message digest and embedded exact image hashes, then become a stub. A same-length corrupt binary permits subsequent text; forged content, explicit resend and content reads still fail. Frozen provider-request hydration retains full binary verification. |
| Text hashes and row revision | Preserve raw text-only Settings coverage hashes; v2 attachment keys remain separate. Restore timeline row revision and expose Input revision only through input_revision. |
| MPF/HDR | Document that MPF rejection also excludes phone HDR gain-map JPEGs, for #83/#84 handoff; no conversion or format expansion. |

New frozen-HEAD full verification, CI and same-session Claude I2 remain required. Real recognition remains NOT_TESTED and merge remains unauthorized.
