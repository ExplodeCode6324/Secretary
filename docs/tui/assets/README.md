# Startup character assets

The 2026-11-13 agile visual refresh adapts Master's Secretary character sheet
(`FC16A300-46C4-4EAA-A7B2-43C5612414F1.PNG`) into the checked-in
`splash-character.svg`. This vector is a deliberately simplified character-grid
interpretation, not a pixel-faithful crop or an edited copy of the original sheet.
It retains silver/lavender long hair, a woven halo, a hoodie collar, natural eye
shapes, and small moon-blue/sun-gold accents. The original sheet remains local.

`src/pi_secretary/src/tui/splash-art.ts` contains the generated 48-column portrait
and 30-column halo. The TUI only loads those text constants; no raster decoding,
external source file, image protocol or generation service runs at startup.

From the repository root:

```sh
node src/pi_secretary/scripts/generate-splash.mjs
node src/pi_secretary/scripts/generate-splash.mjs --check
npx tsx src/pi_secretary/scripts/tui-preview.ts splash 120 30
npx tsx src/pi_secretary/scripts/tui-preview.ts splash 80 18
npx tsx src/pi_secretary/scripts/tui-preview.ts chat 100
```

The preview height is the available splash slot, excluding the input/footer area.
Previews use synthetic data and start no Core. `braille-art.ts` performs a
deterministic build-time conversion; `generate-splash.mjs` records the exact
palette, crop, contrast and size parameters for both assets. Actual glyph weight
and spacing depend on the terminal font.

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
