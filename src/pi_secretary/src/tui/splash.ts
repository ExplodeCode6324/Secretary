import {
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import { SPLASH_HALO, SPLASH_PORTRAIT } from "./splash-art.ts";
import { paintHex, theme } from "./theme.ts";

/** Everything the splash shows. All values are display-only and already sanitised by the caller. */
export type SplashInfo = {
  connection: "connecting" | "ready" | "unavailable";
  /** Reason shown when the Core cannot be reached. */
  detail?: string;
  mainModel?: string;
  taskModel?: string;
  mode?: string;
  session?: string;
  /** Open matters waiting for Master, when known. */
  attention?: number;
  reasoningShown?: boolean;
};

type Art = {
  cols: number;
  palette: readonly string[];
  cells: readonly string[];
  ink: readonly string[];
};

/** Colour one art row with run-length SGR: one escape per colour run, not per cell. */
function artRow(art: Art, row: number): string {
  const cells = Array.from(art.cells[row]),
    ink = art.ink[row];
  let out = "",
    run = "",
    slot = " ";
  const flush = () => {
    if (run)
      out +=
        slot === " " ? run : paintHex(art.palette[parseInt(slot, 16)])(run);
    run = "";
  };
  for (let i = 0; i < art.cols; i++) {
    const next = ink[i] ?? " ";
    if (next !== slot) flush();
    slot = next;
    run += slot === " " ? " " : cells[i];
  }
  flush();
  return out;
}

const pad = (line: string, width: number) =>
  line + " ".repeat(Math.max(0, width - visibleWidth(line)));
const centre = (line: string, width: number) =>
  " ".repeat(Math.max(0, Math.floor((width - visibleWidth(line)) / 2))) + line;

export class Splash implements Component {
  info: SplashInfo = { connection: "connecting" };
  /** Rows the layout slot can show; used to pick a tier and centre vertically. */
  height = () => 24;
  invalidate() {}

  private panel(): string[] {
    const i = this.info,
      key = theme.hint,
      row = (label: string, value: string) =>
        key(pad(label, 10)) + theme.body(value);
    const status =
      i.connection === "ready"
        ? theme.ok("●") + theme.body(" 已连接")
        : i.connection === "connecting"
          ? theme.working("◌") + theme.body(" 正在连接 Core…")
          : theme.attention("●") +
            theme.body(" Core 不可用" + (i.detail ? " · " + i.detail : ""));
    return [
      theme.heading("S E C R E T A R Y"),
      theme.rule("━".repeat(17)),
      "",
      row("Core", "") + status,
      ...(i.mainModel ? [row("主模型", i.mainModel)] : []),
      ...(i.taskModel && i.taskModel !== i.mainModel
        ? [row("任务模型", i.taskModel)]
        : []),
      ...(i.mode ? [row("模式", i.mode)] : []),
      ...(i.session ? [row("会话", i.session)] : []),
      ...(i.reasoningShown !== undefined
        ? [
            row(
              "思考显示",
              i.reasoningShown ? "开 · /cotv 切换" : "关 · /cotv 切换",
            ),
          ]
        : []),
      ...(i.attention
        ? [row("事项", "") + theme.waiting(`${i.attention} 项待处理`)]
        : []),
      "",
      theme.hint("/help 命令 · Shift+Enter 发送 · PageUp 历史"),
      theme.faint("开始输入即进入对话"),
    ];
  }

  /** Art on the left, panel on the right, each vertically centred on the other. */
  private beside(art: Art, panel: string[], gap: number): string[] {
    const rows = Math.max(art.cells.length, panel.length),
      artTop = Math.floor((rows - art.cells.length) / 2),
      panelTop = Math.floor((rows - panel.length) / 2);
    return Array.from({ length: rows }, (_, r) => {
      const a = r - artTop;
      const left =
        a >= 0 && a < art.cells.length ? artRow(art, a) : " ".repeat(art.cols);
      return left + " ".repeat(gap) + (panel[r - panelTop] ?? "");
    });
  }

  render(width: number): string[] {
    const available = Math.max(1, this.height()),
      fullPanel = this.panel(),
      panel =
        available < fullPanel.length
          ? [
              fullPanel[3],
              fullPanel[0],
              ...fullPanel.slice(4).filter(Boolean),
            ].slice(0, available)
          : fullPanel,
      panelWidth = Math.max(...panel.map(visibleWidth)),
      gap = 4;
    const fits = (art: Art) =>
      width >= art.cols + gap + panelWidth + 2 &&
      available >= Math.max(art.cells.length, panel.length);
    const portrait: Art = SPLASH_PORTRAIT,
      halo: Art = SPLASH_HALO;
    let lines: string[];
    if (fits(portrait)) lines = this.beside(portrait, panel, gap);
    else if (fits(halo)) lines = this.beside(halo, panel, gap);
    else if (
      width >= Math.max(halo.cols, panelWidth) + 2 &&
      available >= halo.cells.length + 1 + panel.length
    ) {
      // Narrow but tall: halo above the panel.
      const inner = Math.max(halo.cols, panelWidth);
      lines = [
        ...halo.cells.map((_, r) => centre(artRow(halo, r), inner)),
        "",
        ...panel,
      ];
    }
    // Text only. Never wrap; clip instead.
    else lines = panel.map((line) => truncateToWidth(line, Math.max(1, width)));
    const block = Math.max(...lines.map(visibleWidth)),
      left = " ".repeat(Math.max(0, Math.floor((width - block) / 2))),
      top = Math.max(0, Math.floor((available - lines.length) / 2));
    return [
      ...Array<string>(top).fill(""),
      ...lines.map((line) => left + line),
    ].slice(0, available);
  }
}
