# Startup character assets

The current startup character is Master's supplied **Luna Braille v0.1** package.
The two original `*.cells.json` files in `luna-braille-v01/` are preserved byte for
byte. They replace the earlier custom SVG portrait and halo. No redraw, color
quantization, point edits, row trimming or runtime resizing is applied.

| Source | Grid | Original SHA-256 |
| --- | --- | --- |
| `luna-56x28-v01.cells.json` | 56 × 28 | `fc46c7430f85b313637866995d713b1979d681517fa6577f71608f33b4cf1347` |
| `luna-72x36-v01.cells.json` | 72 × 36 | `f25bfa7bedbb1c60e2d5d247ab18cb185ef917f3ed1181bb99022eb0494f0541` |

`generate-splash.mjs` packages each exact character and RGB value into static
TypeScript constants, using a lossless palette with two-digit indices. The TUI
renders foreground color runs through its existing truecolor / 256-color /
no-color support. It does not print the supplied ANSI files outside the renderer
and does not require Python or access to Downloads at runtime. The package's
background reference is #171921; the TUI retains the terminal's own background.

The largest complete grid that fits beside the information panel is selected.
Narrow, tall windows can stack the whole portrait above the panel; smaller slots
show text only. With the ordinary five-row input/footer and one-row activity
area, approximately 120 × 36 terminal cells show the 56 × 28 version and
140 × 44 show the 72 × 36 version. Additional attention/attachment rows need more
height. The old custom halo is no longer used as a fallback.

From the repository root:

```sh
node src/pi_secretary/scripts/generate-splash.mjs
node src/pi_secretary/scripts/generate-splash.mjs --check
npx tsx src/pi_secretary/scripts/tui-preview.ts splash 120 30
npx tsx src/pi_secretary/scripts/tui-preview.ts splash 140 38
npx tsx src/pi_secretary/scripts/tui-preview.ts splash 80 18
```

Preview height is the available splash slot, excluding the input/footer area.
Previews use synthetic data and start no Core. The supplied PNGs use Noto Sans
Symbols 2; the real terminal's font/fallback and line spacing may differ.

Both the generic CLI and agile launcher enable the startup splash and activity
motion by default. `SECRETARY_TUI_SPLASH=off` skips the splash;
`SECRETARY_TUI_MOTION=off` keeps a static activity mark;
`SECRETARY_TUI_COLOR=truecolor|256|none` chooses color depth. With no explicit
color override, nonempty `NO_COLOR` disables the theme's SGR styles. Agile's
launcher preserves only those validated visual settings through its existing
SECRETARY environment reset; runtime paths and credentials remain fixed.

The splash uses the current connection and session state. Model labels are
omitted because the public Core response does not expose them. The first input
enters the normal editor without being consumed. Current Main activity reveals
the transcript; pending delivery/recovery notices take priority over artwork.

The expanded test coverage includes synthetic previews, no-color Markdown,
first CJK/command/paste input, resize, source-row mapping, and activity lifecycle.
`tui-visual/startup.test.ts` uses a temporary Core fixture and runs in CI, not on
the sole agile workstation instance. Master review of the local candidate is
required before merging the PR into agile.
