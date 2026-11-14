# 004 implementation evidence / 实施记录

2026-11-13. Master approved implementation and explicitly waived Claude review.
The delivery order is PR → CI → local candidate deployment → Master review →
merge into agile. This PR must remain unmerged until Master accepts the deployed
candidate. No main merge is authorized.

## Changes

- Applied and adapted the supplied reference package: semantic colors, Master
  message borders, startup tiers, and a bounded Main activity indicator.
- Connected both CLI entry points, including the actual agile launcher and a
  validated allowlist for visual settings. Core data/configuration routing is
  unchanged.
- Replaced oversized dark eye disks with a reproducible vector interpretation:
  silver/lavender hair, natural eyes, small blue/amber irises, knot halo and hoodie
  collar. The original sheet is untouched. Font-dependent aesthetic acceptance
  remains Master's decision.
- Accounted for editor/attention/attachment space, short windows, recovery and
  pending delivery. The first CJK character, slash and bracketed paste retain
  their normal editor behavior. Model names are omitted unless supplied through
  a real source; the current runtime supplies none.
- Bound animation to visible Main activity and connected state, and stop it for
  hidden views/disconnect/exit. Updated the macOS CI list to include new tests.

## Local validation before PR

- TypeScript check, documentation link/localization checks, changed TypeScript
  formatting, Node script syntax and generated-asset reproducibility passed.
- 55 distinct pure/client-mock tests passed across TUI visual/input, issue82
  input/view, issue83 presentation and issue91 body/Markdown rendering suites.
  No local Core fixture, replacement runtime or database cleanup helper ran.
- First broader test run found three old ANSI-parity expectations affected by
  the runner's inherited NO_COLOR. Those suites now pin the color mode; dedicated
  no-color tests independently cover the new behavior. All affected tests passed
  on rerun. Initial test-authoring syntax/type errors were corrected before PR.
- Generated artwork has rectangular cells and valid palette indices; the vector
  source and generation parameters are checked in. Preview scripts use synthetic
  content and no service connection.

完整服务、数据库和启动计时器集成测试由 GitHub CI 执行；本机只连接现有唯一敏捷实例。
PR 当前提交的 CI、待审部署清单和实际终端结果在 PR/本地私有证据中追加。
物理键盘中文输入法与 Master 审美验收未由自动测试替代。首次待审部署不前移 agile
分支引用，不停止 Core，也不创建第二实例；若本地已有 TUI 占用，不终止 Master 的进程。


## R2 · Master supplied Luna v0.1 replacement

Master directly requested replacing the custom character with the supplied
`luna-braille-v01` package, then updating the local preview for inspection.
All ten package-manifest checksums were verified. The two source character grids
are copied unchanged and packaged losslessly, preserving all original characters
and 73/90 RGB colors respectively. The full 56×28 and 72×36 compositions are
selected by available space; small slots fall back to text. The prior custom
SVG/halo and their image-conversion script are retired from the active source.
Conversation styling, input behavior and Core/data handling are unchanged.

This supersedes R1's custom character direction. Continue on PR #118; refresh CI
before updating the existing local candidate overlay. Master review remains the
merge gate. The original work package, prior commit and private deployment
preimages are retained.
