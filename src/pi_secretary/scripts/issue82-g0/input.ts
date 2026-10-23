// G0 experiment only. This framing is NOT approved for product input.
export const PASTE_START = "\x1b[200~";
export const PASTE_END = "\x1b[201~";
export type InputEvent = {
  kind: "keys" | "paste" | "quarantine";
  text: string;
};

/** Keep incomplete delimiters across chunks. There is intentionally no claim
 * that bracketed paste authenticates its end marker (see the split attack test).
 */
export class ProbeFramer {
  private pending = "";
  private paste: string | undefined;
  constructor(private readonly emit: (event: InputEvent) => void) {}

  feed(chunk: string): void {
    this.pending += chunk;
    if (this.pending.length + (this.paste?.length ?? 0) > 4 * 1024 * 1024) {
      this.emit({ kind: "quarantine", text: "input limit exceeded" });
      this.pending = "";
      this.paste = undefined;
      return;
    }
    const events: InputEvent[] = [];
    let endedPaste = false;
    while (this.pending) {
      const marker = this.paste === undefined ? PASTE_START : PASTE_END;
      const index = this.pending.indexOf(marker);
      if (index >= 0) {
        const before = this.pending.slice(0, index);
        if (this.paste === undefined) {
          if (before) events.push({ kind: "keys", text: before });
          this.paste = "";
        } else {
          const text = this.paste + before;
          events.push({ kind: "paste", text: text.replace(/\r\n?/g, "\n") });
          this.paste = undefined;
          endedPaste = true;
        }
        this.pending = this.pending.slice(index + marker.length);
        continue;
      }
      let suffix = 0;
      for (let n = 1; n < marker.length; n++) {
        if (this.pending.endsWith(marker.slice(0, n))) suffix = n;
      }
      const text = this.pending.slice(0, this.pending.length - suffix);
      this.pending = this.pending.slice(this.pending.length - suffix);
      if (this.paste === undefined) {
        if (text) events.push({ kind: "keys", text });
      } else this.paste += text;
      break;
    }
    // Defense in depth only: a later raw chunk cannot be authenticated this way.
    const suspicious =
      endedPaste &&
      events.some((e) => e.kind === "keys" && /[\x03\x07\x13]/.test(e.text));
    for (const event of events)
      this.emit(
        suspicious && event.kind === "keys"
          ? { ...event, kind: "quarantine" }
          : event,
      );
  }

  flushEscape(): void {
    if (this.paste === undefined && this.pending === "\x1b") {
      this.pending = "";
      this.emit({ kind: "keys", text: "\x1b" });
    }
  }
}

export function safeText(text: string): string {
  return text
    .replace(
      /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,
      (c) => `<${c.charCodeAt(0).toString(16).padStart(2, "0")}>`,
    )
    .replace(/\t/g, "⇥   ");
}
