# Issue #63 · Conversation validation

Implementation and validation are in progress. Master approved R2 with thinking enabled by default and both thinking/tool details collapsed by default. The same Claude Opus 5.5 Extra conversation will review the PR. No merge or issue closure is authorized.

## Evidence obtained

- Core regression reproduced missing outcome/source metadata before the change; outcome mapping, original event identity and expired-preview revision now pass.
- Desktop logic: 31 TypeScript tests and 6 Python tests pass; Svelte check reports 0 errors/warnings. Tests include 100 paging cycles, bounded rows/bytes, pinned-row eviction refusal, late responses, revision/cursor loops, grapheme boundaries, Markdown/URL safety and thinking defaults.
- Rust storage: failed/unresolved body retention, access beyond the last 50, isolated-domain reads, exact failed-row discard and quota preserving the only draft pass. Schema remains v1.
- An actual accepted POST with damaged version/receipt response is recorded UNCERTAIN and resolved through the original request ID without a second POST. A loopback proxy damages only the response after the real fixture Core accepts the message.
- Native WKWebView synthetic fixture: 1,000 rows, long Chinese/ZWJ text, 10,000-line code and a >2 MiB fixture are available. The executed suite verified thinking ON/collapsed, expansion, long-text EOF copy with exact pbpaste equality, write-only UTF-8 clipboard fallback, rejected file URL, two-direction window controls and draft preservation across page navigation. Large code/limit fixtures and remaining stress cases require their dedicated checks; fixture availability alone is not acceptance.
- [Real-model evidence](live.json): native multi-round conversation, real read-only memory_read tool call, incremental output, injected SSE disconnection, injected current-provider-stream abort and explicit session/resume recovery. Both attempts share the original durable budget ledger. No keys, raw prompts/replies or endpoint tokens are published.
- Full Rust reliability suite passed before the final session-subscription addition; final exact-source rerun is pending. Full Core suite, ordinary Release resource comparison, final native rebuild and CI are pending at this checkpoint.

## First failures and attribution

| Failure | Disposition |
| --- | --- |
| Core outcome test failed on the baseline | Added direct source/outcome metadata and regression evidence. |
| New Rust fixture opened an unsafe temporary directory | Created the private child directory required by existing Storage rules; rerun passed. |
| Native driver's callback treated an expected error-shaped result as a protocol failure | Wrapped expected rejection under a separate failure field; rerun passed. The application correctly rejected the URL. |
| Real injected stream abort left session RECOVERY_BLOCKED without a frontend resume action | Added the existing session/resume command to the narrow bridge allowlist, session projection and a confirmed UI action; native rerun passed. No Core state-machine change. |

Raw logs, review requests/replies and screenshots are ignored under `.demo-data/issue63/`. Dedicated profiles `issue63-fixture` and `issue63-live`, isolated Core directories and PostgreSQL `secretary_issue63_live` were used. Ordinary diagnostic Release scenarios bypass profile/Bridge initialization and remain disconnected.

System Pinyin IME, assistive technology and Master's final visual/perceived-performance acceptance are not established by automated logic tests. Linux desktop remains deferred / NOT_TESTED; Core Linux CI remains required. Outstanding #62 acceptance is not waived by #63.
