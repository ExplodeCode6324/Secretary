import { StringDecoder } from "node:string_decoder";
import { StdinBuffer, type Terminal } from "@earendil-works/pi-tui";
import { ProbeFramer, type InputEvent } from "./input.ts";

export type Trace = (kind: string, detail: unknown) => void;
export const RESTORE =
  "\x1b[?2004l\x1b[?1006l\x1b[?1004l\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[>4;0m\x1b[?7h\x1b[?2026l\x1b[?1049l\x1b[?25h\x1b[0m";
export function filterRendererOutput(data: string): string {
  // pi-tui emits a redundant empty OSC8 close after each line. Remove that
  // exact renderer reset, reject all remaining hyperlink/clipboard sequences.
  const filtered = data.replace(/\x1b\]8;;(?:\x07|\x1b\\)/g, "");
  if (/\x1b\](?:52|8);/.test(filtered))
    throw new Error("G0 forbids OSC52/OSC8");
  return filtered;
}

export class ProbeTerminal implements Terminal {
  readonly kittyProtocolActive = false;
  private readonly decoder = new StringDecoder("utf8");
  private readonly keys = new StdinBuffer();
  private readonly framer: ProbeFramer;
  private input?: (data: string) => void;
  private resize?: () => void;
  private escapeTimer?: NodeJS.Timeout;
  private wasRaw = false;
  private lastModes = 0;
  constructor(
    private readonly trace: Trace,
    private readonly paste: (event: InputEvent) => void,
    private readonly mouse = true,
  ) {
    this.framer = new ProbeFramer((event) => {
      this.trace("framed", event);
      if (event.kind === "keys") this.keys.process(event.text);
      else this.paste(event);
    });
    this.keys.on("data", (data) => {
      this.trace("key", { data });
      if (data === "\x1b[I") this.modes(true);
      this.input?.(data);
    });
  }
  get columns(): number {
    return process.stdout.columns ?? 80;
  }
  get rows(): number {
    return process.stdout.rows ?? 24;
  }
  private readonly onData = (data: Buffer): void => {
    this.trace("raw", {
      base64: data.toString("base64"),
      hex: data.toString("hex"),
    });
    this.framer.feed(this.decoder.write(data));
    clearTimeout(this.escapeTimer);
    this.escapeTimer = setTimeout(() => this.framer.flushEscape(), 50);
  };
  private readonly onResize = (): void => {
    this.trace("resize", { columns: this.columns, rows: this.rows });
    this.modes(true);
    this.resize?.();
  };
  start(onInput: (data: string) => void, onResize: () => void): void {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error("G0 requires a TTY");
    this.input = onInput;
    this.resize = onResize;
    this.wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.on("data", this.onData);
    process.stdout.on("resize", this.onResize);
    process.stdin.resume();
    this.modes(true);
  }
  modes(force = false): void {
    if (!force && Date.now() - this.lastModes < 250) return;
    this.lastModes = Date.now();
    this.write(
      "\x1b[?2004h\x1b[?1004h" +
        (this.mouse ? "\x1b[?1000h\x1b[?1002h\x1b[?1006h" : ""),
    );
  }
  stop(): void {
    clearTimeout(this.escapeTimer);
    this.keys.destroy();
    process.stdin.off("data", this.onData);
    process.stdout.off("resize", this.onResize);
    try {
      this.write(RESTORE);
    } finally {
      if (process.stdin.isTTY) process.stdin.setRawMode(this.wasRaw);
      process.stdin.pause();
    }
  }
  async drainInput(): Promise<void> {
    /* Probe never queues input for a shell. */
  }
  write(data: string): void {
    process.stdout.write(filterRendererOutput(data));
  }
  moveBy(lines: number): void {
    if (lines) this.write(`\x1b[${Math.abs(lines)}${lines < 0 ? "A" : "B"}`);
  }
  hideCursor(): void {
    this.write("\x1b[?25l");
  }
  showCursor(): void {
    this.write("\x1b[?25h");
  }
  clearLine(): void {
    this.write("\x1b[2K");
  }
  clearFromCursor(): void {
    this.write("\x1b[J");
  }
  clearScreen(): void {
    this.write("\x1b[2J\x1b[H");
  }
  setTitle(): void {}
  setProgress(): void {}
}
