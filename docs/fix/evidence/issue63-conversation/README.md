# Issue #63 · Conversation validation

Implementation checkpoint after I0 corrections; final exact-head CI/review and Release resource cohorts are recorded on PR #78 after code freeze. Master approved R2 with thinking enabled by default and both thinking/tool details collapsed by default. The same Claude Opus 5.5 Extra conversation will review the PR. No merge or issue closure is authorized.

## Evidence obtained

- Core regression reproduced missing outcome/source metadata before the change; outcome mapping, original event identity and expired-preview revision now pass.
- Desktop logic: 34 TypeScript tests and 6 Python tests pass; Svelte check reports 0 errors/warnings. Tests include 100 paging cycles, bounded rows/bytes, pinned-row eviction refusal, late responses, revision/cursor loops, grapheme boundaries, Markdown/URL safety and thinking defaults.
- Rust storage: failed/unresolved body retention, access beyond the last 50, isolated-domain reads, exact failed-row discard and quota preserving the only draft pass. Schema remains v1.
- An actual accepted POST with damaged version/receipt response is recorded UNCERTAIN and resolved through the original request ID without a second POST. A loopback proxy damages only the response after the real fixture Core accepts the message.
- Native WKWebView synthetic fixture: 1,000 rows, long Chinese/ZWJ text, 10,000-line code and a >2 MiB fixture are available. The executed suite verified thinking ON/collapsed, expansion, long-text EOF copy with exact pbpaste equality, write-only UTF-8 clipboard fallback, rejected file URL, two-direction window controls and draft preservation across page navigation. Large code/limit fixtures and remaining stress cases require their dedicated checks; fixture availability alone is not acceptance.
- [Real-model evidence](live.json): native multi-round conversation, real read-only memory_read tool call, incremental output, injected SSE disconnection, injected current-provider-stream abort and explicit session/resume recovery. Both attempts share the original durable budget ledger. No keys, raw prompts/replies or endpoint tokens are published.
- Full Core suite: 658 tests passed with PostgreSQL, no skips. The expanded public API suite additionally passes 15 tests including source IDs and activity-ID around lookup. Preview payloads with large Chinese/escaped text and thinking remain within 64 KiB.
- Final session-subscription Rust rerun passed (30 reliability tests, 3 conversation tests, launch tests; one intentionally ignored subprocess worker is invoked by its parent). The I0-correction build adds only native-test snapshot timing instrumentation; its rerun is tracked with the final PR evidence.
- I0-correction native runs pass delayed-snapshot scroll/selection behavior; 10,000-line code one-action EOF copy; >2 MiB labelled partial limit; complete UNKNOWN outbox body copy/restore; whitespace-only draft protection. Launch locale variables were removed for the native UTF-8 fallback run.
- Native matrix passes eight PhaseUI suites, including actual 480/599/600/601/849/850/851/1099/1100/1101/1180 widths, 100/125/150/200% zoom, dark mode, dialog focus and keyboard/synthetic composition guards. Synthetic composition is not system IME.
- Actual Bridge full-snapshot IPC: 30 warm samples on a 51,851-byte fixture snapshot; median 1 ms end-to-end, median 211 µs snapshot construction and maximum 343 µs; observed mutex wait 0 µs at microsecond resolution in this uncontended sample. Native-test opt-in instrumentation is absent from ordinary Release. This does not bound slow-network contention; the separate 1.2s delayed-snapshot native test verifies scroll behavior during waiting.
- Initial commit 806c037 passed all four PR checks: Core macOS/Linux, desktop macOS and verify. Ordinary Release resource cohorts and CI/review on the final correction head remain pending at this checkpoint.

## First failures and attribution

| Failure | Disposition |
| --- | --- |
| Core outcome test failed on the baseline | Added direct source/outcome metadata and regression evidence. |
| New Rust fixture opened an unsafe temporary directory | Created the private child directory required by existing Storage rules; rerun passed. |
| Native driver's callback treated an expected error-shaped result as a protocol failure | Wrapped expected rejection under a separate failure field; rerun passed. The application correctly rejected the URL. |
| Real injected stream abort left session RECOVERY_BLOCKED without a frontend resume action | Added the existing session/resume command to the narrow bridge allowlist, session projection and a confirmed UI action; native rerun passed. No Core state-machine change. |

Raw logs, review requests/replies and screenshots are ignored under `.demo-data/issue63/`. Dedicated profiles `issue63-fixture` and `issue63-live`, isolated Core directories and PostgreSQL `secretary_issue63_live` were used. Ordinary diagnostic Release scenarios bypass profile/Bridge initialization and remain disconnected.

System Pinyin IME, assistive technology and Master's final visual/perceived-performance acceptance are not established by automated logic tests. Linux desktop remains deferred / NOT_TESTED; Core Linux CI remains required. Outstanding #62 acceptance is not waived by #63.

## I0 code review and corrections

Claude Opus 5.5 Extra inspected the complete 66-file diff at 806c037. Verdict: CHANGES_REQUIRED. Its attempted npm install failed with DNS ENOTFOUND; it executed no tests, Rust builds or model calls. Source findings and Codex evidence remain distinct.

- B1/B2: live rows now come directly from the baseline subscription plus SSE. Off-tail reading freezes the displayed window and shows new activity; only stable history descriptors are re-queried. A pin conflict becomes an explicit stale/manual-refresh state. Position is captured after waits and restoration checks a scroll sequence.
- S1–S5: revalidation uses the active thinking cursor scope; transient thinking survives text revisions by call/epoch; two active foreground reads have a four-waiter bounded FIFO; rail refresh preserves displayed results/artifact; activities show their timestamp.
- C1/C3–C6: one-action bounded EOF copy, expanded source/around and no-retention-command native tests, explicit history indicator, selectable link text, no-inherited-locale validation.
- C2 disposition: the existing confirmed session/resume command is required to complete the approved injected-abort recovery scenario. It changes neither Core's state machine nor API and never resends a prior message. Its user-triggered paid-call behavior is explicitly included in Master's final review; no merge or deployment is authorized here.
- Additional self-review: empty cursor fragments cannot grow metadata; whitespace drafts are protected; selected text and copy use the same displayed revision; truncated activity detail is labelled.

Raw first failures remain under the ignored validation folder, including the old native test's broad hidden-dialog selector and an OFF-versus-BASE test-launch mismatch. The corrected native matrix passes.

Native link selection was also verified with the macOS Cmd+C action through the native UI driver and exact pbpaste equality. Two earlier attempts using the embedded WebDriver's synthetic DOM keyboard action did not invoke the system Copy menu; those first failures remain preserved. System Pinyin activation was attempted in a disconnected fixture, but produced zero composition events and zero submits: system IME remains NOT_TESTED, not passed.

## I2 阅读修订与竞争测量

I1 复核（1612d12）返回 **CHANGES_REQUIRED**，仅源码复核。I2 修复 B3：冻结窗口成员，保留现有行 SSE 正文，按 ID 原位更新持久结果；新行通过新动态提示进入。B4 先按当前思考开关获取真实 around 页再翻页，失败恢复旧窗口，并让夹具游标检查作用域。真实 Core 默认 ON 原生翻页、延迟快照/选区/超过 5,000 字符流式正文/开关/原位完成回归通过；35 项 TypeScript 与 6 项 Python 通过。暂停专用 Core 制造竞争时，mutex 等待 1,162,427µs、快照序列化 326µs、端到端 1,166ms，不代表正常延迟或最坏上界；暖快照 51,851 字节，mutex 等待 0µs、序列化 189–433µs。I1 四项 CI 全过；本记录时 I2 精确提交 CI、复核及 18 次普通 Release 资源测量待完成。原真实模型账本保持 13 次，40 分钟窗口结束；最终阅读单轮追加窗口等待 Master 授权，尚未执行或重置。系统拼音、VoiceOver、最终视觉与感知性能仍待人工验收。Reviewer 接受带确认的 session/resume 作为已披露计划差异，最终仍由 Master 决定。

原始记录：`native-scope-i2.log`、`native-reading-i2-pass.log`、`native-contention-i2-rerun.log`（忽略目录）。首次失败保留：阅读断言规范末尾 DOM 换行；竞争测量首版误用锁外查询，修正后实测。最终精确 HEAD 证据冻结后记录到 PR #78。

## R3 long-reply completion correction

Master requires N1 to be fixed and explicitly approves retaining C2, the confirmed session/resume entry. The row now retains its already displayed body when Core supplies a shorter durable first fragment. Bounded authoritative reads recover at least that prior length or EOF, without appending preview text into durable content. The retained state is labelled; a failed read keeps the text, stops automatic retries and offers manual retry. Selection, revision/epoch guards, residency and existing byte/read/cursor caps remain enforced. Thinking OFF also permits body catch-up.

The old binary reproduced the shrink against a Core-like 4,999-unit first fragment. The corrected native WKWebView runs pass automatic catch-up and OFF-mode failure/retry, each with more than 5,000 displayed units, preserved selection/row identity and zero observed anchor/stream-scroll drift. First harness failures (wrong automatic-stream scenario, a length-observation race, persisted preference and wrong launch mode) remain separate from that product regression. Frontend logic passes 39 TypeScript and 6 Python tests; Svelte has zero errors/warnings, Core type checking and documentation checks pass.

The real-model harness now caps model output before Core computes its capacity budget and rejects startup/task calls before admission. Master authorized exactly one more call on the original ledger: entry 15 used the isolated `issue63-final-reading-r3` profile, fresh Core store and PostgreSQL database. Startup consumed no admission. The provider reported 4,096 output tokens, all 4,096 reasoning, with stop reason `length`; the native test timed out before observing the required >5,500-character body. **Final real-model long-body completion remains NOT_ACCEPTED.** This is not a passed reading test. No further call, ledger reset or budget extension occurred. The earlier entry 14 local capacity failure is preserved. See [sanitized R3 outcome](final-reading-r3.json).

Final R3 exact-head review, CI and 18 ordinary Release measurements are recorded on PR #78 after source freeze. System Pinyin, VoiceOver and Master's visual/perceived-performance acceptance remain pending; no merge, closure or deployment is authorized.
