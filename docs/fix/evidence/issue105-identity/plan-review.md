# #105 plan review / 计划复核

- Scope / 范围：plan only；Master 批准后才实施；合并另需批准。
- Baseline：`5aa5753a940e38164582fdc3368e8e307e6f5c2f`，包含 #103 / #104。
- Reviewer：Claude Opus 5.5 Extra；已在界面确认，使用 [Master 已打开的会话](https://claude.ai/chat/14cf8a15-0d9c-47eb-897a-c1928865a382)。
- [中文计划](../../fix_20261107_issue105_identity.md) / [English plan](../../fix_20261107_issue105_identity.en.md)
- Raw evidence：Git-ignored `.demo-data/issue105/review/`。
- R1：2026-11-07 00:17:41 HKT 提交；00:27 HKT 首次读取时仍在输出，已见 CHANGES_REQUIRED。等待完整报告后再提交 R2。产品代码、数据迁移、产品测试、模型调用、原生终端与 CI：NOT_RUN；计划文档检查 PASS。


## R1 — CHANGES_REQUIRED

Submitted 2026-11-07 00:17:41 HKT; first read at 00:27 HKT still streaming; full report read at 00:32 HKT after the five-minute interval. Two blockers accepted:

| Finding / 意见 | Disposition / 处置 |
| --- | --- |
| Store.stage also runs on every historical replay; migration classification was underspecified | 明确帧前状态 + 当前帧的校验；Task version 加全域一次 activation 日志事件；完整重开测试覆盖迁移/activation/升级后执行。 |
| Pi text-selection fallback also dispatches component click | 必须有本热点消费过的 press 记录，核对当前布局/scrollTop/目标；无记录 click 不处理；滚轮取消手势但继续滚动。 |
| Migration placement | App.open 在 Store.open 后、所有 auth/scheduler recovery 前执行。 |
| Reuse/REDO title and v1 null hash | 候选仅新建；reuse 明确拒绝，REDO 沿现有 correctable 拒绝；null 从 options 省略。 |
| #103 actionability behavior | 明确列出新 Main/Master 引导对 RESULT_UNKNOWN/RETIRED/归档 Scope 的收紧；原受理 replay 保持；两种来源及竞态回归。 |
| One-way upgrade | 真实升级前停止写者、完整一致备份并验证隔离副本；本轮不迁移。 |
| Optional minimum auto ID-prefix | 不采纳最短长度建议，以保留旧短 ID 兼容；所有标题补全带引号，真歧义明确提示 --id/引号。 |
| Round/body grammar | 拒绝 07/全角数字；#106 轮次后首个 ASCII 空格为分隔，余正文保真，全空白拒绝。 |

Reviewer assessed #106 forecast as **no drift**. It inspected Secretary baseline sources and pinned Pi, ran a VirtualTerminal click-lifecycle experiment, and read summarized issue fetches (not raw bodies). No product/migration/provider/native tests ran in that review. Codex confirmed source findings and added invisible-only title fallback and explicit navigation-vs-command draft semantics. R2 requests the full revised plan's readiness; no product implementation started.

## R2 — PASS (plan readiness only)

Submitted 2026-11-07 00:36:00 HKT; observed after the ten-minute wait at 00:46 HKT. Reviewer found no remaining blocker, accepted short-ID compatibility, and again assessed the #106 forecast as **no drift**. This is plan readiness only, not implementation or merge authority.

Final nonblocking precisions incorporated in both languages:

1. Unicode-table-dependent checks run only at allocation; replay uses engine-independent UTF-16/scalar/byte/control constraints and exact identity. No normalization/grapheme/display-base reclassification on replay.
2. **Supersedes R1 disposition / R2-submitted proposal:** do not reject archived scopes in #103 internal-ID admission. Started work can keep running after archive and retains existing steering capability. Archive exclusion stays in TaskBrowser lookup. New RESULT_UNKNOWN guidance is explicitly rejected for both Main/Master; RETIRED already fails terminal checks. Preserve old accepted receipt replay. Both-source/race and archived-running-work regression cases are explicit.
3. Post-activation hand-built Execution fixtures, especially issue18/helpers.ts, must use real allocation and the counter transaction; no production validation weakening for tests.
4. New UUID-shaped title candidates fall back, including goal/truncation cases; assigned titles remain immutable. Short prefixes remain supported, ambiguity errors remain explicit and completion always quotes titles.
5. #106 help explains the required ASCII space before a multiline body; trim only checks whitespace emptiness. Codex additionally clarified against the existing GuidanceCommand schema that frozen request-format version/fingerprint does not introduce a volatile Execution expected_revision constraint.

R2 directly inspected scopes.ts, retention.ts and issue18/helpers.ts, and relied on R1 source/VirtualTerminal experiment. It did not run product tests/migration/provider/native checks, and did not independently verify Codex docs:check. Final precision incorporation is recorded under its expressly nonblocking PASS; no independent third round claimed.

Screenshot: ignored `.demo-data/issue105/review/r2-pass.png`. Both round requests, plan snapshots, full AX reports, timestamps and hash manifest are retained in the same ignored directory.

## Delivery boundary / 交付边界

- Plan-only; product/schema/test/CI/deployment/provider/migration changes: none.
- Plan documentation checks: `npm run docs:check` and `git diff --check` PASS; final verification details stored in ignored validation log.
- Product tests / real data migration / real-model / native terminal / hosted CI for #105: NOT_RUN.
- No PR, merge, issue closure or product acceptance claim. Master implementation approval remains pending by explicit request.
