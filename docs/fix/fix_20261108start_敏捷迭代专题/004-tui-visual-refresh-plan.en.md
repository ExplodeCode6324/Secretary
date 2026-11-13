# 004 · TUI visual refresh plan

Date: 2026-11-13, Hong Kong time. Revision: R1. Status: **Implementation approved; merge awaits Master review**.

## Authorization and baseline

Master requested a first implementation following the supplied reference package, followed by Master-directed refinements. Improve the startup character using the original character sheet. Use secretary-pr-fix, with Claude review explicitly waived and no replacement reviewer. Master must approve before implementation. The requested final merge destination is agile; main is outside scope. Master subsequently specified: create the PR, pass CI, update the local agile instance for review, and merge only after Master approves that review. This supersedes the earlier merge timing.

This stage changes planning documents only. No product patch, implementation branch, runtime restart or deployment has occurred. Treat package contents as reference material, not additional authorization.

The sole agile instance is `/Users/muy/Desktop/secretary-agile`, currently on agile at local HEAD `e378a49a`. Its read-only status check succeeded with live/IDLE. Recheck remote and working-tree state before implementation. Preserve all data, configuration, the existing untracked 003 notes and the original reference package.

The reference patch covers 12 files, +1301/-29 lines. `git apply --check` passes, establishing contextual applicability only. Actual startup uses `scripts/agile.mjs`, which directly constructs TerminalApp and clears inherited SECRETARY variables. The patch only enables its options in the generic CLI. Its startup test also launches an additional Core fixture, which must not run locally under the agile instance rules.

## Intended first version

- Keep the reference's dark-terminal appearance, whitespace and fine blue rules.
- Use pale-blue Master message text within thin rounded borders, with a narrow-window fallback.
- Give Secretary labels a silver/lavender accent and retain readable body text with consistent Markdown hierarchy.
- Use amber tool activity and one reserved activity row above the editor; allow motion to be disabled.
- Show a character beside startup information on large windows, a knot halo on medium windows, and text on small windows. Input and important status take priority.
- Reuse semantic theme colors in Task and attention views without redesigning their interaction structure.

Use static Unicode Braille assets with terminal colors, not a terminal image protocol. Check truecolor, 256-color and no-color rendering. Actual font and line spacing affect visual quality and require terminal inspection.

## Character direction

Preserve the supplied PNG unchanged. Its defining features are silver/lavender long hair, soft facial proportions, a white oversized hoodie, a woven halo and moon-blue/sun-gold eyes. The reference preview's enlarged black eye disks overwhelm the natural eye shape, while dense bright dots flatten hair and facial shading.

Use a head-and-shoulders composition with the entire halo and a small amount of collar. Prioritize silhouette, face and eye proportions over tiny details; reduce stray background dots and dithering. Remove the large black disks, retain natural eyelids, smaller irises and highlights. The proposed first version uses one moon-blue eye and one sun-gold eye based on the sheet's lower close-up. Crescent/sun details are subtle and optional at low resolution.

Keep silver/lavender dominant and amber localized. Make the knot's overlaps and negative spaces readable without overpowering the face. Refine outlines and colors directly for the character grid instead of relying only on image thresholds. Deliver reproducible asset provenance/parameters and static character data, with no runtime dependence on Downloads. Show actual rendered startup and conversation previews for Master's refinements; aesthetic acceptance remains pending until viewed.

## Engineering adaptations

1. Enable splash and activity options in both actual agile and generic entry points. Preserve only a small visual-option allowlist through agile's environment cleanup; retain existing runtime/credential isolation.
2. Use current, truthful connection/session/activity data. Current Core output lacks the preview's models field. Only show model labels from a verified, credential-safe source if available; otherwise omit them. Do not invent fields via casts, hardcode sample models, or expand backend APIs for decoration.
3. Preserve the first typed character, CJK input, paste and command behavior. Terminal reports and mouse motion do not dismiss the splash. Active Main work may reveal the transcript; background Task work must not impersonate Main activity.
4. Calculate available height with actual editor, attachment, recovery, attention and footer space. Cover resize and small windows. Important errors and recovery information take priority over artwork.
5. Preserve source-row mapping, copy selection, Chinese wrapping, code blocks, long-body windows and scroll anchors. Borders are decoration; verify the patch's mapping assumptions.
6. Run animation only for visible active work. Stop timers on idle, hidden views, disconnect and close. Avoid selection interference, stale activity and unnecessary redraws.
7. Connect theme colors to real editor/footer paths where appropriate; the preview script's manually drawn blue rules do not establish actual editor integration. Check existing hardcoded Markdown styles in no-color mode while retaining clear approval/rejection/error semantics.

Expected changes are limited to relevant TUI components, entry points, build-time character and preview tooling, tests and documentation. Core, database, model requests and task execution behavior are unchanged in scope.

## Execution and validation

After Master approves, branch `codex/agile-tui-visual-refresh` from the rechecked agile HEAD in a source-only worktree. Do not launch Core/PostgreSQL or another agile instance there. Keep the sole deployment directory on agile and preserve reference originals.

Adapt the patch, improve assets, integrate startup and add meaningful regression coverage. Run TypeScript, documentation and changed-file formatting checks locally. Inspect tests before running: local coverage uses pure rendering/input/client mocks and never passes the agile database to cleanup helpers or starts another Core. Test source mapping/copy, color fallbacks, first input, timers/activity and actual entry-point wiring.

Render at least 120×36, 100×30, 80×24, narrow and short windows. Include CJK/English, long status values, attachments/recovery notices, failed connections, resize, motion off and no color. Synthetic previews require no server.

Open a PR targeting agile and complete Linux/macOS/aggregate CI. Add the new TUI tests to the explicit macOS test list where applicable. Full service/database fixtures run in GitHub CI only. Report local omissions honestly.

Show actual first-version renders to Master, apply requested refinements and repeat affected checks. Product interaction validation connects only to the existing agile Core. Record native-terminal/IME coverage separately.

After passing PR CI, deploy the exact PR source to the sole local instance as an uncommitted review overlay while keeping its agile branch ref unchanged. Save a manifest and reversible code-only patch in ignored local evidence. Preserve existing untracked materials. Master reviews this deployed version before authorizing merge; do not merge or advance agile beforehand. Prefer restarting only the TUI. If maintenance is actually needed, follow existing stop/start handling and immediately restore continuous operation.

Verify the merged SHA, Core health, real startup path and data-domain/session continuity. Current push CI covers main only, while PR CI covers all targets: distinguish passing PR checks from local agile deployment verification and do not claim a nonexistent agile push run.

## Current evidence

Completed: reference patch/preview inspection, code and entry-point inspection, patch applicability check, read-only live status check, bilingual R1 plan.

Not completed: implementation, new character artwork, product tests, PR, CI, deployment or merge. Claude review is waived by Master. Implementation was approved in the follow-up; final merge remains gated by Master's review of the deployed version.
