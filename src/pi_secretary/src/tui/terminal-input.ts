import { randomUUID } from "node:crypto";
import type { TuiApp } from "./app.ts";
import { parseSubmission } from "./commands.ts";
import { Clipboard } from "./clipboard.ts";
import { inputChunks, type TerminalFrame } from "./terminal-stream.ts";

export const ACTIONS = [
  "Submit",
  "Commands",
  "Literal",
  "Resume",
  "Import clipboard text",
  "Copy",
  "Cut",
  "Undo",
  "Redo",
  "Set mark / Clear mark",
  "Apply large edit",
  "Cancel large edit",
  "Copy record",
  "Restore record",
  "Expand/collapse paste",
  "Quit",
] as const;
type Job = {
  frame: Exclude<TerminalFrame, { kind: "fault" }>;
  epoch: number;
  bytes: number;
  complete?: () => Promise<void>;
};
const authorityKeys = new Set(["\x13", "\x12", "\x18", "\x16"]);
export class TerminalInput {
  refusal = "";
  bar = false;
  selectedAction = 0;
  mark = false;
  small = false;
  quarantined = false;
  exiting = false;
  exitRefusedBytes = 0;
  exitUnconfirmedDecision = false;
  onExitRequest: () => void = () => {};
  private exitTimer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private queue: Job[] = [];
  private bytes = 0;
  private running = false;
  private scheduled?: ReturnType<typeof setImmediate>;
  private modalPainted = false;
  private epoch = 0;
  private paintedDecision = "";
  private clipboardJob?: {
    id: string;
    text: string;
    generation: number;
    epoch: number;
    cut: boolean;
  };
  onScroll: (direction: number) => void = () => {};
  constructor(
    readonly app: TuiApp,
    readonly repaint: () => void,
    readonly clipboard = new Clipboard(),
  ) {}
  get generation() {
    return this.app.outbox.generation;
  }
  connect() {
    this.app.outbox.connect(this.generation + 1);
    void this.app.outbox.observe().catch((error) => {
      if (this.closed || this.exiting) return;
      this.app.notice = `Read-only outbox status unavailable: ${String(error)}`;
      this.repaint();
    });
  }
  rotateLease() {
    const g = this.generation;
    this.app.outbox.disconnect(g);
    this.app.outbox.connect(g + 1);
    // Also block admissions whose disk ACK arrives after the lease rotation.
    this.app.outbox.needsResume = true;
    this.app.outbox.status = "waiting for explicit Resume";
  }
  resize(columns: number, rows: number) {
    const small = columns < 40 || rows < 12;
    if (small && !this.small) this.rotateLease();
    this.small = small;
    this.repaint();
  }
  private decision() {
    return this.app.decisionState.key;
  }
  painted() {
    const pending = this.decision();
    if (pending !== this.paintedDecision) this.epoch++;
    this.paintedDecision = pending;
    this.modalPainted = !!this.app.decisionState.large;
  }
  /** Clipboard completions share the controller queue; guards run at execution time.
   * ACKs may precede deferred edits so a modal cannot strand a completed OS write. */
  private completion(complete: () => Promise<void>, bytes = 0, ack = false) {
    if (this.closed || this.exiting) return;
    if (this.bytes + bytes > 8 * 1024 * 1024) {
      this.fail(
        "INPUT_QUEUE_BOUND: clipboard completion refused; Resume required",
      );
      return;
    }
    const job: Job = {
      frame: { kind: "key", text: "" },
      epoch: this.epoch,
      bytes,
      complete,
    };
    if (ack) this.queue.unshift(job);
    else this.queue.push(job);
    this.bytes += bytes;
    this.schedule();
  }
  fail(reason: string, preservePastes = false) {
    if (this.closed) return;
    const retained = preservePastes
      ? this.queue.filter((job) => !job.complete && job.frame.kind === "paste")
      : [];
    const retainedBytes = retained.reduce((sum, job) => sum + job.bytes, 0);
    const refusedBytes = this.bytes - retainedBytes;
    this.refusal = `${reason}${refusedBytes ? `; ${refusedBytes} queued bytes refused` : ""}`;
    this.queue = retained;
    this.bytes = retainedBytes;
    this.quarantined = true;
    this.rotateLease();
    this.repaint();
  }
  receive(frame: TerminalFrame) {
    if (this.closed) return;
    if (frame.kind === "key" && ["\x03", "\x1c"].includes(frame.text)) {
      this.requestExit();
      return;
    }
    if (this.exiting) return;
    if (frame.kind === "fault") {
      this.fail(frame.reason, frame.preserveCompletedPastes);
      return;
    }
    const control =
      frame.kind === "key" &&
      (this.bar ||
        ["\x14", "\x1bOQ", "\x1b[12~", "\x1b", "\x0f", "\x15", "\x04"].includes(
          frame.text,
        ));
    if (this.modalPainted && !control) {
      this.refusal =
        "Choose Apply or Cancel before new input; input refused (not queued).";
      this.repaint();
      return;
    }
    const bytes = Buffer.byteLength(frame.text);
    if (this.bytes + bytes > 8 * 1024 * 1024) {
      this.fail("INPUT_QUEUE_BOUND: queued input refused; Resume required");
      return;
    }
    const job = { frame, epoch: this.epoch, bytes };
    // Decision/navigation keys must remain reachable while pre-prompt benign edits wait.
    if (this.modalPainted && control) {
      const firstDeferred = this.queue.findIndex(
        (item) => item.epoch !== this.epoch,
      );
      if (firstDeferred < 0) this.queue.push(job);
      else this.queue.splice(firstDeferred, 0, job);
    } else this.queue.push(job);
    this.bytes += bytes;
    this.schedule();
  }
  private requestExit() {
    if (this.exiting) {
      void this.app.close();
      return;
    }
    this.exiting = true;
    this.rotateLease(); // no queued or late-ACK admission can initiate a new POST
    this.bar = false;
    this.exitUnconfirmedDecision = !!this.decision();
    const editing = new Set([
      "\r",
      "\n",
      "\x7f",
      "\x08",
      "\x1b[3~",
      "\x1b[A",
      "\x1b[B",
      "\x1b[C",
      "\x1b[D",
      "\x02",
      "\x06",
      "\x01",
      "\x05",
    ]);
    const retained = this.decision()
      ? []
      : this.queue.filter(
          (job) =>
            !job.complete &&
            (job.frame.kind !== "key" || editing.has(job.frame.text)),
        );
    const retainedBytes = retained.reduce((sum, job) => sum + job.bytes, 0);
    this.exitRefusedBytes += this.bytes - retainedBytes;
    this.queue = retained;
    this.bytes = retainedBytes;
    this.onExitRequest(); // terminal restoration is synchronous, before draining or disk waits
    this.exitTimer = setTimeout(() => {
      void this.app.close();
    }, 1000);
    this.schedule();
  }
  private schedule() {
    if (!this.running && !this.scheduled && !this.closed)
      this.scheduled = setImmediate(() => {
        this.scheduled = undefined;
        void this.drain();
      });
  }
  private async drain() {
    this.running = true;
    try {
      while (this.queue.length && !this.closed) {
        if (this.exiting && this.decision()) {
          this.exitRefusedBytes += this.bytes;
          this.queue = [];
          this.bytes = 0;
          break;
        }
        const job = this.queue[0];
        const pending = this.app.decisionState.large;
        if (this.decision() && this.decision() !== this.paintedDecision) {
          this.repaint();
          break;
        }
        if (pending && job.epoch !== this.epoch && !job.complete) {
          if (job.frame.kind === "key" && authorityKeys.has(job.frame.text)) {
            this.queue.shift();
            this.bytes -= job.bytes;
            this.refusal =
              "Authority action refused across a pending decision.";
            continue;
          }
          break;
        }
        this.queue.shift();
        this.bytes -= job.bytes;
        if (
          job.epoch !== this.epoch &&
          job.frame.kind === "key" &&
          authorityKeys.has(job.frame.text)
        ) {
          this.refusal = "Authority action refused across a decision.";
          continue;
        }
        try {
          if (job.complete) await job.complete();
          else await this.dispatch(job.frame, job.epoch);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          if (/^(INPUT_TRANSACTION_TOO_LARGE|DRAFT_TOO_LARGE)/.test(reason))
            this.fail(reason);
          else this.refusal = reason;
        }
        if (this.exiting && this.decision()) {
          this.exitUnconfirmedDecision = true;
          this.exitRefusedBytes += job.bytes;
        }
        if (!this.decision() && this.paintedDecision) {
          this.epoch++;
          this.paintedDecision = "";
        }
        this.repaint();
      }
    } finally {
      this.running = false;
      if (this.exiting && !this.queue.length) void this.app.close();
    }
  }
  /** A completed paint can expose a decision, but cannot authorize it. */
  afterPaint() {
    this.painted();
    this.schedule();
  }
  async idle() {
    while (this.running || this.scheduled)
      await new Promise((resolve) => setImmediate(resolve));
  }
  private event(value: Record<string, unknown>, generation = this.generation) {
    return this.app.event(
      { revision: this.app.editor().draft.revision, ...value },
      generation,
    );
  }
  private async insert(text: string, paste: boolean) {
    if (!text) return;
    const revision = this.app.editor().draft.revision,
      generation = this.generation;
    const chunks = [...inputChunks(text)];
    if (!paste && chunks.length === 1) {
      await this.event({ type: "insert", text });
      return;
    }
    const id = randomUUID();
    await this.app.event(
      { type: "begin", revision, id, source: paste ? "paste" : "composition" },
      generation,
    );
    for (let index = 0; index < chunks.length; index++)
      await this.app.event(
        { type: "chunk", revision, id, index, text: chunks[index] },
        generation,
      );
    await this.app.event({ type: "commit", revision, id }, generation);
  }
  private requireAuthority() {
    if (this.small) throw Error("TOO_SMALL: resize to at least 40x12");
    if (this.quarantined)
      throw Error("INPUT_QUARANTINED: inspect refusal, then explicitly Resume");
  }
  private safeSubmit() {
    try {
      const parsed = parseSubmission(
        this.app.editor().draft,
        this.app.store.state.view,
        this.app.config.aliases,
      );
      return (
        parsed.kind === "command" &&
        [
          "help",
          "outbox",
          "quit",
          "latest",
          "history",
          "select",
          "more",
          "cotvisible",
          "copy",
        ].includes(parsed.name)
      );
    } catch {
      return false;
    }
  }
  private async action(name: string, capturedEpoch = this.epoch) {
    if (
      capturedEpoch !== this.epoch &&
      [
        "Submit",
        "Resume",
        "Cut",
        "Import clipboard text",
        "Restore record",
        "Apply large edit",
        "Cancel large edit",
      ].includes(name)
    )
      throw Error("Authority action refused across a decision.");
    if (name === "Quit") {
      this.requestExit();
      return;
    }
    if (name === "Resume") {
      if (this.small) this.requireAuthority();
      this.quarantined = false;
      this.refusal = "";
      await this.event({ type: "action", action: "resume" });
      return;
    }
    if (
      [
        "Submit",
        "Cut",
        "Import clipboard text",
        "Restore record",
        "Apply large edit",
      ].includes(name) &&
      !(name === "Submit" && this.safeSubmit())
    )
      this.requireAuthority();
    if (name === "Set mark / Clear mark") {
      this.mark = !this.mark;
      return;
    }
    if (name === "Undo" || name === "Redo") {
      await this.event({ type: "undo", redo: name === "Redo" });
      return;
    }
    if (name === "Apply large edit" || name === "Cancel large edit") {
      await this.event({
        type: "confirm-large",
        accept: name === "Apply large edit",
      });
      this.modalPainted = false;
      return;
    }
    if (name === "Copy record" || name === "Restore record") {
      const record = this.app.snapshot().record;
      if (!record) throw Error("Select a record using /outbox <id> first");
      await this.app.event(
        {
          type: "record-action",
          id: record.id,
          action: name === "Copy record" ? "copy" : "restore",
        },
        this.generation,
      );
      return;
    }
    if (name === "Import clipboard text") {
      const editor = this.app.editor(),
        revision = editor.draft.revision,
        selection = { ...editor.draft.selection },
        generation = this.generation,
        epoch = this.epoch;
      this.app.notice = "Reading clipboard text…";
      void this.clipboard
        .read()
        .then((text) =>
          this.completion(async () => {
            this.requireAuthority();
            if (
              this.closed ||
              generation !== this.generation ||
              editor !== this.app.editor() ||
              revision !== editor.draft.revision ||
              selection.anchor !== editor.draft.selection.anchor ||
              selection.head !== editor.draft.selection.head ||
              epoch !== this.epoch ||
              this.decision()
            )
              throw Error("STALE_CLIPBOARD_IMPORT");
            await this.insert(text, true);
            this.app.notice =
              "Imported clipboard text as data; nothing submitted.";
          }, Buffer.byteLength(text)),
        )
        .catch((error) => {
          this.refusal = String(error);
        })
        .finally(() => this.repaint());
      return;
    }
    if (name === "Expand/collapse paste") {
      const { nodes, selection } = this.app.editor().draft;
      let offset = 0;
      const node = nodes.find((n) => {
        const start = offset;
        offset += n.text.length;
        return (
          n.kind === "paste" &&
          selection.head >= start &&
          selection.head <= offset
        );
      });
      if (!node) throw Error("Move caret onto a paste block first");
      await this.event({
        type: "paste-display",
        id: node.id,
        expanded: !node.expanded,
      });
      return;
    }
    await this.event({ type: "action", action: name.toLowerCase() });
  }
  private async dispatch(
    frame: Exclude<TerminalFrame, { kind: "fault" }>,
    capturedEpoch: number,
  ) {
    if (frame.kind !== "key") {
      this.bar = false;
      await this.insert(frame.text, frame.kind === "paste");
      return;
    }
    const key = frame.text;
    if (key === "\x1b[I") {
      this.repaint();
      return;
    }
    if (key === "\x1b[O") return;
    if (["\x14", "\x1bOQ", "\x1b[12~"].includes(key)) {
      this.bar = !this.bar;
      this.selectedAction = 0;
      return;
    }
    if (this.bar) {
      if (key === "\x1b") {
        this.bar = false;
        return;
      }
      if (["\t", "\x1b[C", "\x1b[B"].includes(key))
        this.selectedAction = (this.selectedAction + 1) % ACTIONS.length;
      else if (["\x1b[Z", "\x1b[D", "\x1b[A"].includes(key))
        this.selectedAction =
          (this.selectedAction + ACTIONS.length - 1) % ACTIONS.length;
      else if (key === "\r" || key === "\n") {
        const name = ACTIONS[this.selectedAction];
        if (
          this.app.decisionState.large &&
          ![
            "Apply large edit",
            "Cancel large edit",
            "Copy",
            "Copy record",
            "Quit",
          ].includes(name)
        )
          throw Error("Choose Apply or Cancel first");
        this.bar = false;
        await this.action(name, capturedEpoch);
      } else
        throw Error(
          "Action bar: Tab/arrows choose, Enter activates, Escape returns",
        );
      return;
    }
    const actions: Record<string, string> = {
      "\x13": "Submit",
      "\x07": "Commands",
      "\x10": "Literal",
      "\x12": "Resume",
      "\x16": "Import clipboard text",
      "\x0f": "Copy",
      "\x18": "Cut",
      "\x1f": "Undo",
      "\x19": "Redo",
      "\0": "Set mark / Clear mark",
    };
    if (actions[key]) {
      await this.action(actions[key], capturedEpoch);
      return;
    }
    if (key === "\x1a")
      throw Error("Suspend is unsupported; Ctrl+C closes the client safely");
    if (key === "\x15" || key === "\x04") {
      this.onScroll(key === "\x15" ? -1 : 1);
      return;
    }
    if (key === "\r" || key === "\n") {
      await this.insert("\n", false);
      return;
    }
    if (key === "\t") {
      await this.event({ type: "complete" });
      return;
    }
    if (key === "\x1b") {
      await this.event({ type: "dismiss" });
      this.modalPainted = false;
      return;
    }
    if (key === "\x7f" || key === "\x08" || key === "\x1b[3~") {
      await this.event({
        type: "delete",
        direction: key === "\x1b[3~" ? "forward" : "backward",
      });
      return;
    }
    const directions: Record<string, string> = {
      "\x1b[A": "up",
      "\x1b[B": "down",
      "\x1b[C": "right",
      "\x1b[D": "left",
      "\x02": "left",
      "\x06": "right",
      "\x01": "home",
      "\x05": "end",
      "\x1b[H": "home",
      "\x1b[F": "end",
      "\x1bOH": "home",
      "\x1bOF": "end",
    };
    const shifted = /^\x1b\[1;2([ABCDHF])$/.exec(key);
    const direction = shifted
      ? directions[`\x1b[${shifted[1]}`]
      : directions[key];
    if (direction) {
      await this.event({
        type: "move",
        direction,
        extend: this.mark || !!shifted,
        word: false,
      });
      return;
    }
    throw Error("UNSUPPORTED_KEY: use Ctrl+T actions; draft retained");
  }
  notify(value: Record<string, unknown>) {
    if (value.type === "scroll-up" || value.type === "scroll-down") {
      this.onScroll(value.type === "scroll-up" ? -1 : 1);
      return;
    }
    if (value.type !== "clipboard") return;
    const generation = this.generation;
    if (this.clipboardJob?.id !== value.id)
      this.clipboardJob = {
        id: String(value.id),
        text: "",
        generation,
        epoch: this.epoch,
        cut: value.cut === true,
      };
    const job = this.clipboardJob!;
    if (job.generation !== generation) {
      this.refusal = "STALE_CLIPBOARD: draft unchanged";
      this.repaint();
      return;
    }
    job.text += String(value.text);
    if (Buffer.byteLength(job.text) > 4 * 1024 * 1024) {
      this.refusal = "CLIPBOARD_BOUND";
      return;
    }
    const acknowledge = async (success: boolean) => {
      const staleCut =
        success && job.cut && (job.epoch !== this.epoch || !!this.decision());
      try {
        await this.app.event(
          {
            type: "clipboard-ack",
            id: value.id,
            offset: value.offset,
            done: !!value.final,
            success: success && !staleCut,
          },
          generation,
        );
      } catch (error) {
        this.refusal = String(error);
      }
      if (staleCut)
        this.refusal = "STALE_CUT: copied text; draft retained across decision";
      this.repaint();
    };
    // Never block input/ACK processing on the OS clipboard; controller validates stale cuts.
    if (value.final)
      void this.clipboard.write(job.text).then(
        () => this.completion(() => acknowledge(true), 0, true),
        () => this.completion(() => acknowledge(false), 0, true),
      );
    else
      queueMicrotask(() => {
        this.completion(() => acknowledge(true), 0, true);
      });
  }
  close() {
    this.closed = true;
    clearImmediate(this.scheduled);
    clearTimeout(this.exitTimer);
    this.exitRefusedBytes += this.bytes;
    this.queue = [];
    this.bytes = 0;
    this.app.outbox.disconnect(this.generation);
  }
}
