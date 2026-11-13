#!/usr/bin/env node
/**
 * Image -> palette-indexed Unicode Braille art. Build-time tool; the TUI never imports it.
 *
 *   npx tsx src/pi_secretary/scripts/braille-art.ts <image> --cols 40 \
 *       [--crop x,y,w,h] [--overlay retouch.svg] [--glow x,y,w,h]
 *       [--paper keep|remove] [--black 0.70] [--white 0.86] [--shade 0.76]
 *       [--floor 0.25] [--colors 10] [--saturate 3] [--name SPLASH_ART]
 *
 * Goal: keep the drawing's own look on a BLACK terminal. Bright areas of the
 * drawing become lit dots, dark line work stays unlit, and each cell keeps the
 * (quantised) colour of the pixels it covers. A light "paper" background would
 * turn into a solid white slab, so --paper remove (default) flood-fills it away
 * from the image border first.
 *
 * --overlay  an SVG the size of the crop, composited before conversion. Use it
 *            to retouch what cannot survive at dot resolution (pupil shapes).
 * --glow     a rectangle (crop pixels) holding something luminous drawn ON the
 *            paper (the halo). Inside it only pixels brighter than the paper are
 *            lit, so the gaps of the knot stay black.
 *
 * Output: a TS module { cols, palette: ["#rrggbb"], cells: [braille rows],
 * ink: [palette-index rows] }. No escape codes are baked in; the TUI picks
 * truecolor / 256 / no-colour at render time.
 */
import { format } from "prettier";
import sharp from "sharp";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const at = args.indexOf("--" + name);
  return at < 0 ? fallback : args[at + 1];
};
const file = args[0];
if (!file || file.startsWith("--")) {
  console.error("usage: braille-art.ts <image> --cols N [--crop x,y,w,h]");
  process.exit(2);
}
const cols = Number(flag("cols", "40"));
const name = flag("name", "SPLASH_ART");
const crop = flag("crop", "") ? flag("crop", "").split(",").map(Number) : null;
const removePaper = flag("paper", "remove") === "remove";
const paperTolerance = Number(flag("tolerance", "0.035"));
const black = Number(flag("black", "0.70")); // brightness at/below this is never lit
const white = Number(flag("white", "0.86")); // brightness at/above this is always lit
const colors = Math.min(16, Number(flag("colors", "10"))); // ink digits are base 16
const saturate = Number(flag("saturate", "3"));
// Tone curve for cell colours: source brightness [shade..top] -> terminal brightness [floor..1].
// High-key art (white hair on white paper) has almost no contrast; this restores volume.
const shade = Number(flag("shade", "0.76"));
const top = Number(flag("top", String(white)));
const floor = Number(flag("floor", "0.25"));
const overlay = flag("overlay", "");
const glow = flag("glow", "") ? flag("glow", "").split(",").map(Number) : null;
const glowBlack = Number(flag("glow-black", "0.945"));
const glowWhite = Number(flag("glow-white", "0.975"));
const SS = 4; // source samples per braille dot, per axis

const image = sharp(file).removeAlpha();
const meta = await image.metadata();
const box = crop
  ? { left: crop[0], top: crop[1], width: crop[2], height: crop[3] }
  : { left: 0, top: 0, width: meta.width!, height: meta.height! };
const rows = Math.max(1, Math.round((cols * box.height) / box.width / 2));
const W = cols * 2,
  H = rows * 4,
  SW = W * SS,
  SH = H * SS;
let cropped = await image.extract(box).png().toBuffer();
if (overlay)
  cropped = await sharp(cropped)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toBuffer();
const { data } = await sharp(cropped)
  .removeAlpha()
  .resize(SW, SH, { fit: "fill", kernel: "lanczos3" })
  .raw()
  .toBuffer({ resolveWithObject: true });
const at = (x: number, y: number) => (y * SW + x) * 3;
// Brightness = luma plus a bonus for strong saturation: a coloured iris or an
// amber glow must count as bright, or it vanishes on a black screen. Pale
// lavender line work gets no bonus and stays dark.
const luma = (r: number, g: number, b: number) =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 +
  1.5 * Math.max(0, (Math.max(r, g, b) - Math.min(r, g, b)) / 255 - 0.25);
const inGlow = (px: number, py: number) =>
  !!glow &&
  px >= (glow[0] * SW) / box.width &&
  px < ((glow[0] + glow[2]) * SW) / box.width &&
  py >= (glow[1] * SH) / box.height &&
  py < ((glow[1] + glow[3]) * SH) / box.height;

// 1. Paper mask: flood from the border through pixels close to the paper colour.
const paper = new Uint8Array(SW * SH);
if (removePaper) {
  const edge: number[] = [];
  for (let x = 0; x < SW; x++) edge.push(at(x, 0), at(x, SH - 1));
  for (let y = 0; y < SH; y++) edge.push(at(0, y), at(SW - 1, y));
  const mid = (c: number) =>
    edge.map((i) => data[i + c]).sort((a, b) => a - b)[edge.length >> 1];
  const p = [mid(0), mid(1), mid(2)];
  const near = (i: number) =>
    Math.hypot(data[i] - p[0], data[i + 1] - p[1], data[i + 2] - p[2]) / 441 <
    paperTolerance;
  const queue: number[] = [];
  const visit = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= SW || y >= SH) return;
    const k = y * SW + x;
    if (paper[k] || !near(k * 3)) return;
    paper[k] = 1;
    queue.push(k);
  };
  for (let x = 0; x < SW; x++) (visit(x, 0), visit(x, SH - 1));
  for (let y = 0; y < SH; y++) (visit(0, y), visit(SW - 1, y));
  while (queue.length) {
    const k = queue.pop()!,
      x = k % SW,
      y = (k / SW) | 0;
    (visit(x + 1, y), visit(x - 1, y), visit(x, y + 1), visit(x, y - 1));
  }
}

// 2. Per-dot brightness (0..1) and mean colour of the non-paper samples.
const value = new Float32Array(W * H);
const rgb = new Float32Array(W * H * 3);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const glowing = inGlow(x * SS, y * SS);
    let n = 0,
      r = 0,
      g = 0,
      b = 0;
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const px = x * SS + sx,
          py = y * SS + sy;
        if (!glowing && paper[py * SW + px]) continue;
        const i = at(px, py);
        ((r += data[i]), (g += data[i + 1]), (b += data[i + 2]), n++);
      }
    const k = y * W + x;
    if (n < (SS * SS) / 2) continue; // mostly paper: stays unlit
    ((r /= n), (g /= n), (b /= n));
    rgb.set([r, g, b], k * 3);
    const [lo, hi] = glowing ? [glowBlack, glowWhite] : [black, white];
    value[k] = Math.max(0, Math.min(1, (luma(r, g, b) - lo) / (hi - lo)));
    if (glowing) rgb.set([255, 255, 255], k * 3); // glow renders as pure light
  }

// 3. Floyd-Steinberg dither: mid-tones become partial dot coverage.
const lit = new Uint8Array(W * H);
const work = Float32Array.from(value);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const k = y * W + x,
      on = work[k] >= 0.5;
    lit[k] = on ? 1 : 0;
    const error = work[k] - (on ? 1 : 0);
    if (x + 1 < W) work[k + 1] += (error * 7) / 16;
    if (y + 1 < H) {
      if (x > 0) work[k + W - 1] += (error * 3) / 16;
      work[k + W] += (error * 5) / 16;
      if (x + 1 < W) work[k + W + 1] += error / 16;
    }
  }

// 4. Cells: braille bits + mean colour of the lit dots (saturation nudged up,
// because pastel shading reads as plain white on black otherwise).
const DOT = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];
type Cell = { bits: number; color?: number[] };
const cells: Cell[] = [];
for (let cy = 0; cy < rows; cy++)
  for (let cx = 0; cx < cols; cx++) {
    let bits = 0,
      n = 0,
      r = 0,
      g = 0,
      b = 0;
    for (let dy = 0; dy < 4; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const k = (cy * 4 + dy) * W + cx * 2 + dx;
        if (!lit[k]) continue;
        bits |= DOT[dy][dx];
        // Saturated dots dominate the cell colour, so a thin iris ring is not
        // washed out by the pale skin sharing its cell.
        const [pr, pg, pb] = [rgb[k * 3], rgb[k * 3 + 1], rgb[k * 3 + 2]];
        const weight =
          1 + (8 * (Math.max(pr, pg, pb) - Math.min(pr, pg, pb))) / 255;
        ((r += pr * weight),
          (g += pg * weight),
          (b += pb * weight),
          (n += weight));
      }
    if (!n) {
      cells.push({ bits: 0 });
      continue;
    }
    ((r /= n), (g /= n), (b /= n));
    const l = luma(r, g, b);
    const t = Math.max(0, Math.min(1, (l - shade) / (top - shade)));
    const gain =
      (floor + (1 - floor) * t * t) / Math.max(Math.max(r, g, b) / 255, 0.01);
    const grey = ((r + g + b) / 3) * gain;
    // Pastels get the full boost; colours that are already vivid get almost none.
    const vivid = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    const boost = 1 + (saturate - 1) * Math.max(0, 1 - vivid * 3);
    const tone = (v: number) =>
      Math.max(0, Math.min(255, grey + (v * gain - grey) * boost));
    cells.push({ bits, color: [tone(r), tone(g), tone(b)] });
  }

// 5. Quantise cell colours to a small palette (k-means, deterministic seeding).
const samples = cells.filter((c) => c.color).map((c) => c.color!);
const count = Math.min(colors, samples.length);
// Farthest-point seeding (deterministic): start from the brightest sample, then
// keep adding the sample farthest from every chosen centre. Small accents — one
// blue pupil, one amber pupil — get their own palette entry instead of being
// averaged into the silver that covers most of the picture.
const distance = (a: number[], b: number[]) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
let centres: number[][] = [
  [
    ...samples.reduce((a, b) =>
      a[0] + a[1] + a[2] > b[0] + b[1] + b[2] ? a : b,
    ),
  ],
];
while (centres.length < count) {
  let far = samples[0],
    farD = -1;
  for (const c of samples) {
    const d = Math.min(...centres.map((m) => distance(c, m)));
    if (d > farD) ((farD = d), (far = c));
  }
  centres.push([...far]);
}
const nearest = (c: number[]) => {
  let best = 0,
    bestD = Infinity;
  centres.forEach((m, i) => {
    const d = distance(c, m);
    if (d < bestD) ((bestD = d), (best = i));
  });
  return best;
};
for (let round = 0; round < 4; round++) {
  const sum = centres.map(() => [0, 0, 0, 0]);
  for (const c of samples) {
    const s = sum[nearest(c)];
    ((s[0] += c[0]), (s[1] += c[1]), (s[2] += c[2]), s[3]++);
  }
  centres = centres.map((m, i) =>
    sum[i][3]
      ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]]
      : m,
  );
}
const hex = (c: number[]) =>
  "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

const cellRows: string[] = [],
  inkRows: string[] = [];
for (let cy = 0; cy < rows; cy++) {
  let chars = "",
    ink = "";
  for (let cx = 0; cx < cols; cx++) {
    const cell = cells[cy * cols + cx];
    chars += String.fromCodePoint(0x2800 + cell.bits);
    ink += cell.color ? nearest(cell.color).toString(16) : " ";
  }
  (cellRows.push(chars), inkRows.push(ink));
}
while (cellRows.length && !inkRows[0].trim())
  (cellRows.shift(), inkRows.shift());
while (cellRows.length && !inkRows.at(-1)!.trim())
  (cellRows.pop(), inkRows.pop());

// Same convention as generate-api.mjs: generated source is emitted already formatted.
process.stdout.write(
  await format(
    `// GENERATED by scripts/braille-art.ts — do not edit by hand.\n` +
      `// source: ${file.split("/").pop()}${crop ? " crop " + crop.join(",") : ""} · ${cols}x${cellRows.length} cells\n` +
      `export const ${name} = ${JSON.stringify({ cols, palette: centres.map(hex), cells: cellRows, ink: inkRows })} as const;\n`,
    { parser: "typescript" },
  ),
);
