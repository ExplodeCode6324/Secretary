import { getCapabilities } from "@earendil-works/pi-tui";

/** The one place TUI colours are defined. Components import tokens, never SGR literals.
 *
 * Provenance: deep / blue / sky / rose are the PhaseUI blues and fault red Master
 * kept on 2026-10-23 (docs/tui/color-provenance.md). moon / amber come from the
 * Secretary character sheet: moon = idle, sun (amber) = working.
 */
export type ColorDepth = "truecolor" | "256" | "none";

// token: [24-bit hex, xterm-256 index]
const PALETTE = {
  deep: ["#285ea6", 25], //   dark blue  — borders, rules, art shadow
  blue: ["#79acd9", 110], //  blue       — headings, links, selection, running
  sky: ["#b1d5ec", 153], //   light blue — Master text
  ice: ["#eef4fb", 255], //   near white — art highlight, emphasis
  moon: ["#c9cce2", 189], //  lavender   — Secretary label, idle mark
  amber: ["#f0b66b", 215], // accent     — working: spinner, tools
  sand: ["#fad091", 222], //  soft amber — waiting / queued
  rose: ["#ed8791", 210], //  accent     — needs attention, failure
  mint: ["#a8d8b9", 151], //  accent     — succeeded
  muted: ["#8792a8", 245], // cool grey  — reasoning, hints
  faint: ["#56607a", 240], // dim grey   — separators, inactive
} as const;
export type Token = keyof typeof PALETTE;

export function detectDepth(): ColorDepth {
  const forced = process.env.SECRETARY_TUI_COLOR?.toLowerCase();
  if (forced === "truecolor" || forced === "256" || forced === "none")
    return forced;
  if (process.env.NO_COLOR) return "none";
  return getCapabilities().trueColor ? "truecolor" : "256";
}
export type Paint = (text: string) => string;
export const style =
  (codes: string): Paint =>
  (text) =>
    depth === "none" ? text : `\x1b[${codes}m${text}\x1b[0m`;
let depth: ColorDepth = detectDepth();
export const colorDepth = () => depth;
/** Tests and the preview script pin the depth; production resolves it once at import. */
export function setColorDepth(value: ColorDepth) {
  depth = value;
}

const channels = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** Nearest xterm-256 entry (6x6x6 cube or grey ramp) for colours without a hand-picked index. */
function nearest256(hex: string): number {
  const [r, g, b] = channels(hex);
  // Cube steps are 0, 95, 135, 175, 215, 255.
  const level = (v: number) =>
    v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.round((v - 55) / 40));
  const cube = [0, 95, 135, 175, 215, 255];
  const [cr, cg, cb] = [level(r), level(g), level(b)];
  const grey = Math.max(
    0,
    Math.min(23, Math.round(((r + g + b) / 3 - 8) / 10)),
  );
  const error = (x: number, y: number, z: number) =>
    (r - x) ** 2 + (g - y) ** 2 + (b - z) ** 2;
  const shade = 8 + grey * 10;
  return error(cube[cr], cube[cg], cube[cb]) <= error(shade, shade, shade)
    ? 16 + 36 * cr + 6 * cg + cb
    : 232 + grey;
}
const sgr = (hex: string, index?: number) =>
  depth === "truecolor"
    ? `38;2;${channels(hex).join(";")}`
    : `38;5;${index ?? nearest256(hex)}`;
const fg = (token: Token) => sgr(PALETTE[token][0], PALETTE[token][1]);
/** For generated art only, whose palette travels with the asset. UI code uses tokens. */
export const paintHex =
  (hex: string): Paint =>
  (text) =>
    depth === "none" ? text : `\x1b[${sgr(hex)}m${text}\x1b[0m`;
/** paint("sky"), paint("blue", "bold"). Depth is read per call, so setColorDepth applies immediately. */
export const paint =
  (token: Token, ...attributes: ("bold" | "dim" | "italic")[]): Paint =>
  (text) => {
    if (depth === "none") return text;
    const codes = attributes.map(
      (a) => ({ bold: "1", dim: "2", italic: "3" })[a],
    );
    return `\x1b[${[...codes, fg(token)].join(";")}m${text}\x1b[0m`;
  };
/** Body text keeps the terminal's own white so user themes still apply. */
export const body: Paint = (text) =>
  depth === "none" ? text : `\x1b[37m${text}\x1b[0m`;
export const bold: Paint = (text) =>
  depth === "none" ? text : `\x1b[1m${text}\x1b[0m`;

/** Semantic aliases — the vocabulary components should use. */
export const theme = {
  body,
  masterText: paint("sky"),
  masterBorder: paint("blue"),
  masterLabel: paint("sky", "bold"),
  assistantLabel: paint("moon", "bold"),
  reasoning: paint("muted"),
  tool: paint("amber"),
  artifact: paint("blue"),
  heading: paint("ice", "bold"),
  link: paint("blue"),
  rule: paint("deep"),
  hint: paint("muted"),
  faint: paint("faint"),
  selected: paint("sky", "bold"),
  running: paint("blue"),
  working: paint("amber"),
  waiting: paint("sand"),
  attention: paint("rose"),
  ok: paint("mint"),
} as const;
