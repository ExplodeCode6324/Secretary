import { createRequire } from "node:module";
import type { Editor } from "@earendil-works/pi-tui";
import {
  findWordBackward,
  findWordForward,
} from "@earendil-works/pi-tui/dist/word-navigation.js";
import { PasteDocument, type OwnedRange, type DraftSnapshot } from "./draft.ts";

type State = { lines: string[]; cursorLine: number; cursorCol: number };
type KillOptions = { prepend: boolean; accumulate?: boolean };
type PiSeam = {
  state: State;
  pastes: Map<number, string>;
  undoStack: {
    push(snapshot: unknown): void;
    pop(): unknown;
    clear(): void;
    length: number;
  };
  killRing: {
    push(text: string, options: KillOptions): void;
    rotate(): void;
    ring: string[];
  };
  lastAction: string | null;
  pushUndoSnapshot(): void;
  moveWordBackwards(): void;
  moveWordForwards(): void;
  handleBackspace(): void;
  handleForwardDelete(): void;
  insertYankedText(text: string): void;
  setCursorCol(column: number): void;
};
type RichState = { ranges: OwnedRange[]; damaged: boolean };
type RichKill = { text: string; ranges: OwnedRange[] };
const packageVersion = createRequire(import.meta.url)(
  "@earendil-works/pi-tui/package.json",
).version;

/** The pinned runtime's TS-private methods are ordinary properties. Keep all access here. */
export class EditorBridge {
  readonly document = new PasteDocument();
  private seam: PiSeam;
  private undo: RichState[] = [];
  private kills: RichKill[] = [];
  private text = "";
  private cursor = 0;
  private claimed = false;
  private insertion?: OwnedRange[];
  private typed = false;
  constructor(readonly editor: Editor) {
    this.seam = editor as unknown as PiSeam;
    const s = this.seam;
    if (
      packageVersion !== "0.87.0" ||
      !s.state ||
      !(s.pastes instanceof Map) ||
      !Array.isArray(s.killRing?.ring) ||
      [
        s.pushUndoSnapshot,
        s.moveWordBackwards,
        s.moveWordForwards,
        s.handleBackspace,
        s.handleForwardDelete,
        s.insertYankedText,
        s.setCursorCol,
        s.undoStack?.push,
        s.undoStack?.pop,
        s.undoStack?.clear,
        s.killRing?.push,
        s.killRing?.rotate,
      ].some((method) => typeof method !== "function")
    )
      throw Error("UNSUPPORTED_PI_EDITOR_SEAM: expected pi-tui 0.87.0");
    const push = s.undoStack.push.bind(s.undoStack),
      pop = s.undoStack.pop.bind(s.undoStack),
      clear = s.undoStack.clear.bind(s.undoStack);
    s.undoStack.push = (snapshot) => {
      push(snapshot);
      this.undo.push({
        ranges: this.document.ranges.map((r) => ({ ...r })),
        damaged: this.document.damaged,
      });
    };
    s.undoStack.pop = () => {
      const result = pop();
      if (result) {
        const rich = this.undo.pop();
        if (!rich) throw Error("PI_RICH_UNDO_DESYNCHRONIZED");
        this.document.ranges = rich.ranges;
        this.document.damaged = rich.damaged;
        this.claimed = true;
      }
      return result;
    };
    s.undoStack.clear = () => {
      clear();
      this.undo = [];
    };
    const kill = s.killRing.push.bind(s.killRing),
      rotate = s.killRing.rotate.bind(s.killRing);
    s.killRing.push = (text, options) => {
      if (!text) return;
      const cursor = this.offset(),
        start = options.prepend ? cursor - text.length : cursor;
      let entry: RichKill = {
        text,
        ranges: this.document.slice(start, start + text.length),
      };
      if (options.accumulate && this.kills.length) {
        const previous = this.kills.pop()!;
        const left = options.prepend ? entry : previous,
          right = options.prepend ? previous : entry;
        entry = {
          text: left.text + right.text,
          ranges: [
            ...left.ranges,
            ...right.ranges.map((r) => ({
              ...r,
              start: r.start + left.text.length,
              end: r.end + left.text.length,
            })),
          ],
        };
      }
      this.kills.push(entry);
      kill(text, options);
    };
    s.killRing.rotate = () => {
      rotate();
      if (this.kills.length > 1) this.kills.unshift(this.kills.pop()!);
    };
    const yank = s.insertYankedText.bind(s);
    s.insertYankedText = (text) => {
      const rich = this.kills.at(-1);
      this.insertion =
        rich?.text === text
          ? rich.ranges
          : [{ start: 0, end: text.length, source: "unknown" }];
      try {
        yank(text);
      } finally {
        this.insertion = undefined;
      }
    };
    s.moveWordBackwards = () => this.word(-1);
    s.moveWordForwards = () => this.word(1);
    const backward = s.handleBackspace.bind(s),
      forward = s.handleForwardDelete.bind(s);
    s.handleBackspace = () => {
      const block = this.document.blockAt(this.offset(), "before");
      if (block) this.remove(block.start, block.end);
      else backward();
    };
    s.handleForwardDelete = () => {
      const block = this.document.blockAt(this.offset(), "after");
      if (block) this.remove(block.start, block.end);
      else forward();
    };
    editor.onChange = () => this.sync();
  }
  offset() {
    const { cursorLine, cursorCol, lines } = this.seam.state;
    return (
      lines.slice(0, cursorLine).reduce((n, line) => n + line.length + 1, 0) +
      cursorCol
    );
  }
  private position(offset: number) {
    const s = this.seam.state;
    let line = 0;
    while (line < s.lines.length - 1 && offset > s.lines[line].length)
      offset -= s.lines[line++].length + 1;
    s.cursorLine = line;
    this.seam.setCursorCol(Math.min(offset, s.lines[line].length));
  }
  begin(typed = false) {
    this.text = this.editor.getText();
    this.cursor = this.offset();
    this.typed = typed;
  }
  finish(directional = false) {
    const previous = this.cursor;
    this.sync();
    const current = this.offset(),
      block = this.document.blockAt(current);
    if (block)
      this.position(
        directional
          ? current < previous
            ? block.start
            : block.end
          : current - block.start <= block.end - current
            ? block.start
            : block.end,
      );
    this.begin();
    if (this.seam.pastes.size) throw Error("PI_STOCK_PASTE_PATH_USED");
  }
  private sync() {
    const next = this.editor.getText(),
      cursor = this.offset(),
      old = this.text;
    if (this.claimed) this.claimed = false;
    else if (next !== old) {
      const delta = next.length - old.length;
      if (
        delta > 0 &&
        cursor === this.cursor + delta &&
        next ===
          old.slice(0, this.cursor) +
            next.slice(this.cursor, cursor) +
            old.slice(this.cursor)
      )
        this.document.splice(
          this.cursor,
          this.cursor,
          delta,
          this.insertion ??
            (this.typed ? [] : [{ start: 0, end: delta, source: "unknown" }]),
        );
      else if (
        delta < 0 &&
        cursor === this.cursor + delta &&
        next === old.slice(0, cursor) + old.slice(this.cursor)
      )
        this.document.splice(cursor, this.cursor, 0);
      else if (
        delta < 0 &&
        cursor === this.cursor &&
        next === old.slice(0, cursor) + old.slice(cursor - delta)
      )
        this.document.splice(cursor, cursor - delta, 0);
      else {
        // Unclaimed replacement is unknown. LCP is only a conservative fallback, never a typed attribution.
        let start = 0,
          end = old.length,
          nextEnd = next.length;
        while (start < end && start < nextEnd && old[start] === next[start])
          start++;
        while (
          end > start &&
          nextEnd > start &&
          old[end - 1] === next[nextEnd - 1]
        ) {
          end--;
          nextEnd--;
        }
        this.document.splice(
          start,
          end,
          nextEnd - start,
          nextEnd > start
            ? [{ start: 0, end: nextEnd - start, source: "unknown" }]
            : [],
        );
      }
    }
    this.text = next;
    this.cursor = cursor;
  }
  insert(text: string, ranges: OwnedRange[]) {
    this.begin();
    this.insertion = ranges;
    try {
      this.editor.insertTextAtCursor(text);
    } finally {
      this.insertion = undefined;
    }
  }
  claimCompletion(oldLength: number, newLength: number, start = 0) {
    this.document.splice(start, oldLength, newLength);
    this.claimed = true;
  }
  restore(
    snapshot: DraftSnapshot,
    write: (text: string) => void,
    clearHistory = true,
  ) {
    this.begin();
    this.claimed = true;
    write(snapshot.text);
    this.document.restore(snapshot);
    // setText's normalizer must never see a raw pasted tab: tab-containing pastes are blocks.
    if (this.editor.getText() !== snapshot.text)
      throw Error("DRAFT_RESTORE_WOULD_CHANGE_TEXT");
    this.seam.state.cursorLine = snapshot.cursor.line;
    this.seam.setCursorCol(snapshot.cursor.col);
    if (clearHistory) this.clearHistory();
    this.finish();
  }
  clearHistory() {
    this.seam.undoStack.clear();
    this.seam.killRing.ring.length = 0;
    this.kills = [];
    this.document.collect();
  }
  private remove(start: number, end: number) {
    this.seam.pushUndoSnapshot();
    const raw = this.editor.getText();
    this.seam.state.lines = (raw.slice(0, start) + raw.slice(end)).split("\n");
    this.position(start);
    this.seam.lastAction = null;
    this.sync();
  }
  private word(direction: -1 | 1) {
    const s = this.seam,
      state = s.state,
      line = state.lines[state.cursorLine],
      lineStart = this.offset() - state.cursorCol;
    s.lastAction = null;
    if (direction < 0 && state.cursorCol === 0) {
      if (state.cursorLine > 0) {
        state.cursorLine--;
        s.setCursorCol(state.lines[state.cursorLine].length);
      }
      return;
    }
    if (direction > 0 && state.cursorCol === line.length) {
      if (state.cursorLine + 1 < state.lines.length) {
        state.cursorLine++;
        s.setCursorCol(0);
      }
      return;
    }
    let at = state.cursorCol;
    if (direction < 0) {
      while (
        at > 0 &&
        /\s/.test(line[at - 1]) &&
        !this.document.blockAt(lineStart + at, "before")
      )
        at--;
      const block = this.document.blockAt(lineStart + at, "before");
      if (block) {
        s.setCursorCol(block.start - lineStart);
        return;
      }
      const boundary = Math.max(
        0,
        ...this.document.ranges
          .filter(
            (r) => r.block && r.end <= lineStart + at && r.end >= lineStart,
          )
          .map((r) => r.end - lineStart),
      );
      s.setCursorCol(
        boundary + findWordBackward(line.slice(boundary, at), at - boundary),
      );
    } else {
      while (
        at < line.length &&
        /\s/.test(line[at]) &&
        !this.document.blockAt(lineStart + at, "after")
      )
        at++;
      const block = this.document.blockAt(lineStart + at, "after");
      if (block) {
        s.setCursorCol(block.end - lineStart);
        return;
      }
      const boundary = Math.min(
        line.length,
        ...this.document.ranges
          .filter(
            (r) =>
              r.block &&
              r.start >= lineStart + at &&
              r.start <= lineStart + line.length,
          )
          .map((r) => r.start - lineStart),
      );
      s.setCursorCol(at + findWordForward(line.slice(at, boundary), 0));
    }
  }
}
