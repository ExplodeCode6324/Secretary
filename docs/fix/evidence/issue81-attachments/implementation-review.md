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
