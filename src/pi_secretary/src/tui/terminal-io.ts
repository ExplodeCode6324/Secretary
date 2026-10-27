import type { Terminal } from "@earendil-works/pi-tui";
import type { ReadStream, WriteStream } from "node:tty";
import { TerminalStream, type TerminalFrame } from "./terminal-stream.ts";

export const RESTORE =
  "\x1b[?2004l\x1b[?1006l\x1b[?1004l\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[>4;0m\x1b[?7h\x1b[?2026l\x1b[?1049l\x1b[?25h\x1b[0m";
export function filterOutput(data: string) {
  const safe = data.replace(/\x1b\]8;;(?:\x07|\x1b\\)/g, "");
  if (/\x1b\](?:52|8);/.test(safe)) throw Error("FORBIDDEN_TERMINAL_OUTPUT");
  return safe;
}
/** No ProcessTerminal, native modifier probe, keyboard negotiation or device queries. */
export class LocalTerminal implements Terminal {
  readonly kittyProtocolActive = false;
  readonly stream: TerminalStream;
  private wasRaw = false;
  private rawEntered = false;
  private screenEntered = false;
  private stopped = false;
  private ready = false;
  private lost = false;
  private resize?: () => void;
  discarded = 0;
  constructor(
    readonly frame: (frame: TerminalFrame) => void,
    readonly loss: (reason: string) => void,
    readonly dimensions: () => void,
    readonly stdin: ReadStream = process.stdin,
    readonly stdout: WriteStream = process.stdout,
  ) {
    this.stream = new TerminalStream(frame);
  }
  get columns() {
    return this.stdout.columns ?? 80;
  }
  get rows() {
    return this.stdout.rows ?? 24;
  }
  private onData = (data: Buffer) => {
    if (this.stopped) return;
    if (!this.ready) {
      this.discarded += data.length;
      return;
    }
    this.stream.feed(data);
  };
  private onResize = () => {
    if (this.stopped) return;
    this.dimensions();
    this.modes();
    this.resize?.();
  };
  private onLoss = (error?: unknown) => {
    if (this.stopped) return;
    this.lost = true;
    this.loss(
      `TERMINAL_LOST${error instanceof Error ? ": " + error.message : ""}`,
    );
  };
  start(_onInput: (data: string) => void, onResize: () => void) {
    if (!this.stdin.isTTY || !this.stdout.isTTY) throw Error("TTY_REQUIRED");
    this.resize = onResize;
    this.wasRaw = !!this.stdin.isRaw;
    let buffered: Buffer | null;
    while ((buffered = this.stdin.read()) !== null)
      this.discarded += buffered.length;
    this.stdin.on("data", this.onData);
    this.stdin.on("end", this.onLoss);
    this.stdin.on("close", this.onLoss);
    this.stdin.on("error", this.onLoss);
    this.stdout.on("error", this.onLoss);
    this.stdout.on("close", this.onLoss);
    this.stdout.on("resize", this.onResize);
    this.stdin.setRawMode(true);
    this.rawEntered = true;
    this.stdin.resume();
    this.modes();
  }
  /** Called only after synchronous first paint and local lease creation. */
  activate() {
    if (!this.stopped) this.ready = true;
  }
  modes() {
    this.write("\x1b[?2004h\x1b[?1004h");
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.ready = false;
    this.stream.reset();
    this.stdin.off("data", this.onData);
    this.stdout.off("resize", this.onResize);
    // Keep error listeners installed until process exit, including during bounded flush.
    try {
      if (!this.lost && (this.rawEntered || this.screenEntered))
        this.stdout.write(RESTORE);
    } catch {
      /* A disappeared terminal cannot receive restoration bytes. */
    } finally {
      try {
        if (this.rawEntered) this.stdin.setRawMode(this.wasRaw);
      } catch {
        /* hangup */
      }
      this.stdin.pause();
    }
  }
  async drainInput() {}
  write(data: string) {
    if (this.stopped || this.lost) return;
    const safe = filterOutput(data);
    if (safe.includes("\x1b[?1049h")) this.screenEntered = true;
    this.stdout.write(safe);
  }
  moveBy(lines: number) {
    if (lines) this.write(`\x1b[${Math.abs(lines)}${lines < 0 ? "A" : "B"}`);
  }
  hideCursor() {
    this.write("\x1b[?25l");
  }
  showCursor() {
    this.write("\x1b[?25h");
  }
  clearLine() {
    this.write("\x1b[2K");
  }
  clearFromCursor() {
    this.write("\x1b[J");
  }
  clearScreen() {
    this.write("\x1b[2J\x1b[H");
  }
  setTitle() {}
  setProgress() {}
}
