# Issue #94 admission and uncertainty boundary

The client classifies direct synchronous POST errors by owning code, never by HTTP status. An accepted receipt wins first; pending retries reconcile before dispatch. Receipt schema validation precedes lookup in ApplicationService, while domain admission follows lookup. Exact immutable request bodies preserve replay compatibility.

| Owner before admission commit | Definite rejection codes |
| --- | --- |
| API envelope/schema | INVALID_REQUEST, INVALID_JSON, REQUEST_TOO_LARGE |
| Host.accept | INVALID_INPUT |
| attachmentBindings / attachmentLimits | INVALID_REQUEST, ATTACHMENT_NOT_READY, ATTACHMENT_UNAVAILABLE, ATTACHMENT_TOO_LARGE, ATTACHMENT_CONFIG_INVALID |
| visionProfile / imageLeaves / dimensions / visionEstimate | ATTACHMENT_MODEL_UNSUPPORTED, ATTACHMENT_BUDGET_CONFIG_INVALID, ATTACHMENT_BUDGET_UNCONFIGURED, ATTACHMENT_INVALID_IMAGE_BLOCK, CAPACITY_BLOCKED |
| budgetConfig / requestBudget / assertRequestBudget | BUDGET_CONFIG_INVALID, CAPACITY_UNCOUNTABLE_REQUEST, CAPACITY_UNCOUNTABLE_NON_TEXT, CAPACITY_OUTPUT_LIMIT, CAPACITY_BLOCKED |
| AttachmentImports.admit | INVALID_REQUEST, ATTACHMENT_TOO_LARGE, ATTACHMENT_CAPACITY_FULL (import attempts only) |

REQUEST_CONFLICT freezes the original identity. Transport loss, unrecognized failures, arbitrary 500/503 responses and journal/Store IO remain uncertain; they do not release the pending body. Errors from later provider serialization/dispatch are business execution results after admission, not synchronous TUI rejection codes. FAILED import receipts preserve the staged source and show failure; QUEUED/PENDING or lost receipts retain the original import identity.

The independent source audit in test_case/offline/issue94/admission-audit.test.ts enumerates the owning functions, extracts their error literals, and fails on unclassified additions or moved owners. The per-code delivery tests verify restoration of text and image material, while the real-Core importer test exercises a bad source digest, lost accepted import response, local restart and lost accepted business-send response. A new admission callee requires updating this audited call graph, not merely adding a UI string.
