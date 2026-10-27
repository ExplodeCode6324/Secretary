import {
  TuiAltScreen,
  setCapabilities,
  KeybindingsManager,
  TUI_KEYBINDINGS,
  setKeybindings,
} from "@earendil-works/pi-tui";
import type { TuiApp, Presentation } from "./app.ts";
import { LocalTerminal } from "./terminal-io.ts";
import { TerminalInput, ACTIONS } from "./terminal-input.ts";
import {
  Palette,
  renderDraft,
  safeText,
  transcript,
  type TranscriptLine,
} from "./terminal-render.ts";

export class TerminalView implements Presentation {
  readonly terminal: LocalTerminal;
  readonly input: TerminalInput;
  readonly palette: Palette;
  private tui?: TuiAltScreen;
  private stopped = false;
  private top = 0;
  private reading?: { id: string; offset: number; local?: boolean };
  private anchorTimer?: ReturnType<typeof setTimeout>;
  private pendingAnchor?: { id: string; offset: number };
  private lines: TranscriptLine[] = [];
  private bodyRows = 1;
  private anchorNotice = "";
  constructor(readonly app: TuiApp) {
    this.palette = new Palette(app.config.color);
    this.input = new TerminalInput(app, () => this.publish());
    this.input.onScroll = (direction) => this.scroll(direction);
    this.terminal = new LocalTerminal(
      (frame) => this.input.receive(frame),
      (reason) => {
        this.input.refusal = reason;
        void app.close();
      },
      () => this.input.resize(this.terminal.columns, this.terminal.rows),
    );
    this.input.onExitRequest = () => {
      this.terminal.stop();
      this.tui?.stop({ preserveScreen: true });
    };
  }
  start() {
    if (this.stopped) throw Error("CLIENT_CLOSED_DURING_STARTUP");
    setCapabilities({
      images: null,
      hyperlinks: false,
      trueColor: this.palette.mode === "truecolor",
    });
    // All input belongs to the canonical controller; disable renderer-level actions.
    setKeybindings(
      new KeybindingsManager(
        TUI_KEYBINDINGS,
        Object.fromEntries(Object.keys(TUI_KEYBINDINGS).map((k) => [k, []])),
      ),
    );
    this.tui = new TuiAltScreen(this.terminal, true, undefined, {
      mouse: false,
      copyOnSelect: false,
      copySelection: async () => "UNSUPPORTED: use app Copy",
    });
    const root = {
      focused: true,
      invalidate() {},
      render: (width: number) => this.render(width),
    };
    this.tui.setLayoutRoot(root);
    this.tui.setFocus(root);
    this.input.connect();
    this.input.resize(this.terminal.columns, this.terminal.rows);
    const anchor = this.app.store.state.anchor;
    if (anchor)
      this.reading = {
        id: anchor.message_id ?? anchor.event_id ?? "",
        offset: anchor.offset,
      };
    this.tui.start();
    this.tui.renderNow();
    this.terminal.activate();
    if (this.terminal.discarded)
      this.input.refusal = `${this.terminal.discarded} pre-ready bytes discarded; no action executed`;
    this.publish();
  }
  publish() {
    if (!this.stopped && !this.input.exiting) this.tui?.requestRender();
  }
  notify(value: Record<string, unknown>) {
    this.input.notify(value);
  }
  private scroll(direction: number) {
    this.top = Math.max(
      0,
      Math.min(
        Math.max(0, this.lines.length - this.bodyRows),
        this.top + direction * Math.max(1, Math.floor(this.bodyRows / 2)),
      ),
    );
    const line = this.lines[this.top];
    if (line?.id) {
      this.reading = { id: line.id, offset: line.offset, local: line.local };
      this.app.sync.pauseFollowing();
      clearTimeout(this.anchorTimer);
      this.pendingAnchor = line.local
        ? undefined
        : { id: line.id, offset: line.offset };
      if (this.pendingAnchor)
        this.anchorTimer = setTimeout(() => this.flushAnchor(), 200);
    }
    this.publish();
  }
  private flushAnchor() {
    clearTimeout(this.anchorTimer);
    const anchor = this.pendingAnchor;
    this.pendingAnchor = undefined;
    if (!anchor || this.app.sync.following) return;
    void this.app.sync.anchor(anchor.id, anchor.offset).catch((error) => {
      this.input.refusal = String(error);
      this.publish();
    });
  }
  private render(width: number) {
    const s = this.app.snapshot(),
      height = Math.max(1, this.terminal.rows);
    const line = (
      text: string,
      tone: "normal" | "blue" | "light" | "error" = "normal",
    ) => this.palette.line(safeText(text), width, tone);
    this.lines = transcript(s, width);
    this.bodyRows = Math.max(1, height - 10);
    if (s.following && !s.anchor) {
      this.reading = undefined;
      clearTimeout(this.anchorTimer);
      this.pendingAnchor = undefined;
    }
    if (
      this.reading?.local &&
      !this.lines.some((line) => line.id === this.reading!.id)
    ) {
      const anchor = s.anchor;
      const id = anchor?.message_id ?? anchor?.event_id;
      this.reading = id && anchor ? { id, offset: anchor.offset } : undefined;
      if (!this.reading) this.app.sync.following = true;
      this.anchorNotice = this.reading
        ? "Local view closed; restored saved reading position."
        : "Local view closed; following latest output.";
    }
    if (this.reading) {
      const resolved =
        s.rows.find(
          (row) =>
            row.id === this.reading!.id || row.event_id === this.reading!.id,
        )?.id ?? this.reading.id;
      const index = this.lines.findIndex((x) => x.id === resolved);
      if (index >= 0) {
        const rows = this.lines.filter((x) => x.id === resolved).length;
        const offset = Math.max(0, Math.min(rows - 1, this.reading.offset));
        this.top = index + offset;
        if (offset !== this.reading.offset)
          this.anchorNotice =
            "Reading offset clamped to wrapped rows at this width.";
      } else {
        this.top = 0;
        this.anchorNotice =
          "Reading anchor unavailable in this bounded page; showing start.";
      }
    } else this.top = Math.max(0, this.lines.length - this.bodyRows);
    const body = this.lines
      .slice(this.top, this.top + this.bodyRows)
      .map((x) => line(x.text));
    while (body.length < this.bodyRows) body.push(line(""));
    const draft = renderDraft(s, width),
      start = Math.max(0, draft.cursor.row - 2);
    const draftLines = draft.lines
      .slice(start, start + 3)
      .map((text) => this.palette.line(text, width, "light"));
    while (draftLines.length < 3) draftLines.push(line(""));
    const status = this.input.bar
      ? `ACTION: ${ACTIONS[this.input.selectedAction]}${ACTIONS[this.input.selectedAction] === "Restore record" && s.record?.restoreConfirmation ? " — confirm replacement" : ""} | Tab/arrows choose; Enter activate${s.largeConfirmation ? " | DECISION" : ""}`
      : this.input.small
        ? "TOO SMALL: 40x12 required; draft retained"
        : this.input.quarantined
          ? "INPUT QUARANTINED: explicit Resume required"
          : s.largeConfirmation
            ? "DECISION: Apply without undo / Cancel via Ctrl+T"
            : `${s.mode} ${s.view} → ${s.target} | ${s.saved ? "SAVED" : "UNSAVED"} r${s.revision}${this.input.mark ? " | MARK" : ""}`;

    const result = [
      line(`Secretary | ${s.view} | ${s.coreMode} | ${s.domain}`, "blue"),
      line(
        `${s.connection}${s.stale ? " STALE" : ""} | ${s.sessionState} | ${s.outbox}${s.resume ? " | RESUME REQUIRED" : ""}`,
        s.error || s.quarantine ? "error" : "blue",
      ),
      ...body,
      line(
        status,
        this.input.small || this.input.quarantined || s.largeConfirmation
          ? "error"
          : "light",
      ),
      ...draftLines,
      line(s.error ?? this.input.refusal ?? "", "error"),
      line(s.notice || this.anchorNotice),
      line(
        this.anchorNotice ||
          `Profile ${s.data} | ${this.palette.mode} | ${this.terminal.columns}x${height}`,
      ),
      line("Candidate keys: ^S Send | Enter NL | ^T Actions | ^C Exit", "blue"),
    ];
    // Keep the decision and safe-exit hint visible even in a tiny window.
    this.terminal.modes();
    this.input.afterPaint();
    return result.length > height
      ? [line(status, "error"), ...result.slice(-(height - 1))].slice(0, height)
      : result;
  }
  close() {
    if (this.stopped) return;
    this.stopped = true;
    this.input.close();
    this.terminal.stop(); // synchronous restoration BEFORE disk/network flush
    this.tui?.stop({ preserveScreen: true }); // cancels timers; terminal write latch is already closed
    this.flushAnchor();
  }
}
