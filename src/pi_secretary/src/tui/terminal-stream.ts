/** Raw terminal bytes carry no authenticated origin. Bracketed paste is framing only. */
export const PASTE_START = "\x1b[200~";
export const PASTE_END = "\x1b[201~";
export type TerminalFrame =
  | { kind: "text" | "paste" | "key"; text: string }
  | { kind: "fault"; reason: string };
export class TerminalStream {
  private decoder = new TextDecoder("utf-8", { fatal: true });
  private buffer = "";
  private paste?: { chunks: string[]; bytes: number; overflow: boolean };
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    readonly emit: (frame: TerminalFrame) => void,
    readonly limit = 4 * 1024 * 1024,
    readonly idleMs = 10000,
    readonly discardLimit = 8 * 1024 * 1024,
  ) {}
  feed(bytes: Uint8Array) {
    let text: string;
    try {
      text = this.decoder.decode(bytes, { stream: true });
    } catch {
      this.fault("INVALID_UTF8: draft retained");
      return;
    }
    this.push(text);
  }
  private fault(reason: string) {
    this.reset();
    this.emit({ kind: "fault", reason });
  }
  reset() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.buffer = "";
    this.paste = undefined;
    this.decoder = new TextDecoder("utf-8", { fatal: true });
  }
  finish() {
    try {
      this.decoder.decode();
    } catch {
      this.fault("INCOMPLETE_UTF8: draft retained");
      return;
    }
    if (this.paste || this.buffer)
      this.fault("INCOMPLETE_INPUT: draft retained");
  }
  private appendPaste(text: string) {
    const paste = this.paste!;
    paste.bytes += Buffer.byteLength(text);
    if (paste.bytes > this.limit) {
      paste.overflow = true;
      paste.chunks = [];
    }
    if (!paste.overflow) paste.chunks.push(text);
    if (paste.bytes > this.discardLimit) {
      this.fault(
        `PASTE_DISCARD_BOUND: ${paste.bytes} bytes discarded; Resume required`,
      );
      return false;
    }
    return true;
  }
  private push(text: string) {
    clearTimeout(this.timer);
    this.buffer += text;
    while (this.buffer) {
      if (this.paste) {
        const end = this.buffer.indexOf(PASTE_END);
        if (end < 0) {
          let keep = Math.min(PASTE_END.length - 1, this.buffer.length);
          while (keep && !PASTE_END.startsWith(this.buffer.slice(-keep)))
            keep--;
          const body = this.buffer.slice(0, this.buffer.length - keep);
          this.buffer = this.buffer.slice(this.buffer.length - keep);
          this.appendPaste(body);
          break;
        }
        const body = this.buffer.slice(0, end);
        const remainder = this.buffer.slice(end + PASTE_END.length);
        this.buffer = "";
        if (!this.appendPaste(body)) return;
        const paste = this.paste!;
        this.paste = undefined;
        if (paste.overflow) {
          this.fault(
            `PASTE_TOO_LARGE: ${paste.bytes} bytes discarded; Resume required`,
          );
          return;
        }
        this.emit({ kind: "paste", text: paste.chunks.join("") });
        // Defence in depth for a same-read hostile delimiter, never authentication.
        if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(remainder)) {
          this.fault(
            "PASTE_TRAILING_CONTROLS: trailing input refused; Resume required",
          );
          return;
        }
        this.buffer = remainder;
        continue;
      }
      if (this.buffer.startsWith(PASTE_START)) {
        this.buffer = this.buffer.slice(PASTE_START.length);
        this.paste = { chunks: [], bytes: 0, overflow: false };
        continue;
      }
      if (this.buffer.startsWith(PASTE_END)) {
        this.emit({ kind: "paste", text: PASTE_END });
        this.buffer = this.buffer.slice(PASTE_END.length);
        continue;
      }
      if (this.buffer[0] === "\x1b") {
        if (
          PASTE_START.startsWith(this.buffer) ||
          PASTE_END.startsWith(this.buffer)
        )
          break;
        let length = 2;
        if (this.buffer[1] === "[" || this.buffer[1] === "O") {
          const final = this.buffer.slice(2).search(/[\x40-\x7e]/);
          if (final < 0) {
            if (this.buffer.length > 64) this.fault("ESCAPE_SEQUENCE_TOO_LONG");
            break;
          }
          length = final + 3;
        }
        this.emit({ kind: "key", text: this.buffer.slice(0, length) });
        this.buffer = this.buffer.slice(length);
      } else {
        const control = this.buffer.search(/[\x00-\x1f\x7f-\x9f]/);
        const length = control < 0 ? this.buffer.length : control || 1;
        this.emit({
          kind: control === 0 ? "key" : "text",
          text: this.buffer.slice(0, length),
        });
        this.buffer = this.buffer.slice(length);
      }
    }
    if (this.paste)
      this.timer = setTimeout(() => {
        this.fault(
          `INCOMPLETE_PASTE: ${this.paste?.bytes ?? 0} bytes discarded; Resume required`,
        );
      }, this.idleMs);
    else if (this.buffer)
      this.timer = setTimeout(() => {
        if (this.buffer === "\x1b") {
          this.buffer = "";
          this.emit({ kind: "key", text: "\x1b" });
        } else this.fault("INCOMPLETE_ESCAPE: draft retained");
      }, 80);
  }
}

/** Chunk by code point without repeatedly materializing a multi-MiB character array. */
export function* inputChunks(text: string, maxBytes = 64 * 1024) {
  let start = 0,
    bytes = 0,
    offset = 0;
  for (const point of text) {
    const size = Buffer.byteLength(point);
    if (bytes + size > maxBytes) {
      yield text.slice(start, offset);
      start = offset;
      bytes = 0;
    }
    bytes += size;
    offset += point.length;
  }
  if (offset > start) yield text.slice(start);
}
