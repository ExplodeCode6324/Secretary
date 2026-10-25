// Actual probe ANSI -> pinned headless terminal cells -> SVG. Not a GUI/IME test.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";
const { Terminal } = createRequire(import.meta.url)("@xterm/headless") as {
  Terminal: typeof HeadlessTerminal;
};
const reportPath = process.argv[2];
if (!reportPath || process.argv.length !== 3)
  throw new Error(
    "Usage: node --import tsx src/pi_secretary/scripts/issue82-g0-render.ts ABSOLUTE_PTY_REPORT.json",
  );
const report = JSON.parse(readFileSync(resolve(reportPath), "utf8"));
const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const manifest: unknown[] = [];
for (const run of report.runs)
  for (const frame of run.frames ?? []) {
    const inputPath = join(run.evidence, frame.ansi);
    const outputPath = inputPath.replace(/\.ansi$/, ".svg");
    if (existsSync(outputPath))
      throw new Error(`Refusing to overwrite ${outputPath}`);
    const ansi = readFileSync(inputPath);
    const terminal = new Terminal({
      cols: frame.columns,
      rows: frame.rows,
      allowProposedApi: true,
      scrollback: 0,
    });
    await new Promise<void>((done) => terminal.write(ansi, done));
    const rows: string[] = [];
    const text: string[] = [];
    let wideCells = 0;
    const cw = 10,
      ch = 20;
    for (let y = 0; y < frame.rows; y++) {
      const line = terminal.buffer.active.getLine(
        terminal.buffer.active.viewportY + y,
      );
      text.push(line?.translateToString(true) ?? "");
      for (let x = 0; x < frame.columns; x++) {
        const cell = line?.getCell(x);
        if (!cell || !cell.getWidth() || !cell.getChars()) continue;
        if (cell.getWidth() === 2) wideCells++;
        const fg = cell.isFgRGB()
          ? `#${cell.getFgColor().toString(16).padStart(6, "0")}`
          : "#dddddd";
        rows.push(
          `<text x="${x * cw + 8}" y="${y * ch + 18}" fill="${fg}" textLength="${cell.getWidth() * cw}" lengthAdjust="spacingAndGlyphs">${escape(cell.getChars())}</text>`,
        );
      }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.columns * cw + 16}" height="${frame.rows * ch + 40}" viewBox="0 0 ${frame.columns * cw + 16} ${frame.rows * ch + 40}"><title>G0 actual ANSI emulation ${frame.columns}x${frame.rows}; not native Terminal or IME</title><rect width="100%" height="100%" fill="#17191c"/><g font-family="'Noto Sans Mono CJK SC', 'Noto Sans CJK SC', monospace" font-size="16">${rows.join("")}</g><text x="8" y="${frame.rows * ch + 29}" fill="#aaa" font-size="11">ANSI → xterm/headless 5.5.0 → SVG | synthetic input | font availability must be recorded</text></svg>`;
    writeFileSync(outputPath, svg, { mode: 0o600, flag: "wx" });
    writeFileSync(
      outputPath.replace(/\.svg$/, ".txt"),
      text.join("\n") + "\n",
      { mode: 0o600, flag: "wx" },
    );
    manifest.push({
      inputPath,
      outputPath,
      columns: frame.columns,
      rows: frame.rows,
      ansiSha256: createHash("sha256").update(ansi).digest("hex"),
      svgSha256: createHash("sha256").update(svg).digest("hex"),
      wideCells,
      footerPresent: text.some((line) => line.includes("DRAFT")),
      evidenceClass: "HEADLESS_EMULATION",
      gui: "NOT_TESTED",
      ime: "NOT_TESTED",
      fontResolution:
        "Inspect in the viewing environment; SVG font list is a request, not proof of installed glyphs",
    });
    terminal.dispose();
  }
const output = resolve(reportPath).replace(/\.json$/, "-render.json");
writeFileSync(output, JSON.stringify(manifest, null, 2), {
  mode: 0o600,
  flag: "wx",
});
console.log(
  JSON.stringify(
    {
      manifest: output,
      frames: manifest.length,
      realTerminal: "NOT_TESTED",
      ime: "NOT_TESTED",
    },
    null,
    2,
  ),
);
