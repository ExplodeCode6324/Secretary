import { Editor, flatten, validText, type Selection } from "./editor.ts";

export const INPUT_CHUNK = 64 * 1024;
const exact = (value: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(value).sort().join() !== keys.sort().join())
    throw Error("INVALID_EVENT_FIELDS");
};
const integer = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
export type Action =
  | "submit"
  | "commands"
  | "literal"
  | "copy"
  | "cut"
  | "resume"
  | "scroll-up"
  | "scroll-down";
export type InputResult = {
  action?: Action;
  changed?: boolean;
  selection?: boolean;
};
/** Input transactions own a frozen app range, never native sink offsets. */
export class InputProtocol {
  private partial?: {
    id: string;
    kind: "paste" | "typed";
    revision: number;
    selection: Selection;
    chunks: string[];
    bytes: number;
    next: number;
    deadline: number;
  };
  private confirmation?: {
    editor: Editor;
    revision: number;
    selection: Selection;
    text: string;
    kind: "paste" | "typed";
    start: number;
    end: number;
  };
  constructor(readonly editor: () => Editor) {}
  get incomplete() {
    return !!this.partial;
  }
  get needsConfirmation() {
    const c = this.confirmation;
    if (c && !this.confirmationMatches(c)) this.confirmation = undefined;
    return !!this.confirmation;
  }
  invalidateConfirmation() {
    this.confirmation = undefined;
  }
  private confirmationMatches(c: NonNullable<InputProtocol["confirmation"]>) {
    const editor = this.editor();
    return (
      c.editor === editor &&
      c.revision === editor.draft.revision &&
      c.selection.anchor === editor.draft.selection.anchor &&
      c.selection.head === editor.draft.selection.head
    );
  }
  reset() {
    this.partial = undefined;
    this.confirmation = undefined;
  }
  private insert(
    text: string,
    kind: "typed" | "paste",
    revision: number,
    selection: Selection,
    range = {
      start: Math.min(selection.anchor, selection.head),
      end: Math.max(selection.anchor, selection.head),
    },
  ): InputResult {
    const editor = this.editor();
    if (
      revision !== editor.draft.revision ||
      selection.anchor !== editor.draft.selection.anchor ||
      selection.head !== editor.draft.selection.head
    )
      throw Error("STALE_INPUT_RANGE");
    if (!text && (kind === "paste" || range.start === range.end)) return {};
    try {
      editor.edit(range.start, range.end, text, kind);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "NON_UNDOABLE_CONFIRMATION_REQUIRED"
      )
        this.confirmation = {
          editor,
          text,
          kind,
          revision,
          selection: { ...selection },
          ...range,
        };
      throw error;
    }
    return { changed: true };
  }
  apply(value: unknown): InputResult {
    const result = this.applyEvent(value);
    if (result.changed || result.selection) this.invalidateConfirmation();
    return result;
  }
  private applyEvent(value: unknown): InputResult {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("INVALID_EVENT");
    const event = value as Record<string, unknown>,
      editor = this.editor();
    if (
      event.type !== "confirm-large" &&
      event.revision !== editor.draft.revision
    )
      throw Error("STALE_REVISION");
    if (this.partial && Date.now() > this.partial.deadline) {
      this.reset();
      throw Error("INPUT_TRANSACTION_EXPIRED");
    }
    if (
      this.partial &&
      !["chunk", "commit", "cancel"].includes(String(event.type))
    )
      throw Error("INPUT_TRANSACTION_INCOMPLETE");
    switch (event.type) {
      case "insert": {
        exact(event, ["type", "revision", "text"]);
        validText(event.text);
        if (Buffer.byteLength(event.text) > INPUT_CHUNK)
          throw Error("INPUT_CHUNK_TOO_LARGE");
        return this.insert(
          event.text,
          "typed",
          editor.draft.revision,
          editor.draft.selection,
        );
      }
      case "begin": {
        exact(event, ["type", "revision", "id", "source"]);
        if (
          this.partial ||
          typeof event.id !== "string" ||
          !/^[a-zA-Z0-9-]{1,64}$/.test(event.id) ||
          !["paste", "composition"].includes(String(event.source))
        )
          throw Error("INVALID_INPUT_TRANSACTION");
        this.partial = {
          id: event.id,
          kind: event.source === "paste" ? "paste" : "typed",
          revision: editor.draft.revision,
          selection: { ...editor.draft.selection },
          chunks: [],
          bytes: 0,
          next: 0,
          deadline: Date.now() + 5000,
        };
        return {};
      }
      case "chunk": {
        exact(event, ["type", "revision", "id", "index", "text"]);
        validText(event.text);
        const p = this.partial;
        if (
          !p ||
          event.id !== p.id ||
          event.index !== p.next ||
          Buffer.byteLength(event.text) > INPUT_CHUNK
        )
          throw Error("INVALID_INPUT_CHUNK");
        p.bytes += Buffer.byteLength(event.text);
        if (p.bytes > 4 * 1024 * 1024 || p.next >= 1024) {
          this.reset();
          throw Error("INPUT_TRANSACTION_TOO_LARGE");
        }
        p.chunks.push(event.text);
        p.next++;
        return {};
      }
      case "commit": {
        exact(event, ["type", "revision", "id"]);
        const p = this.partial;
        if (!p || event.id !== p.id) throw Error("INVALID_INPUT_TRANSACTION");
        this.partial = undefined;
        return this.insert(p.chunks.join(""), p.kind, p.revision, p.selection);
      }
      case "cancel":
        exact(event, ["type", "revision"]);
        this.reset();
        return {};
      case "confirm-large": {
        exact(event, ["type", "revision", "accept"]);
        const c = this.confirmation;
        this.confirmation = undefined;
        if (typeof event.accept !== "boolean" || !integer(event.revision))
          throw Error("INVALID_EVENT_FIELDS");
        if (!c) throw Error("LARGE_EDIT_EXPIRED: paste or edit again");
        if (!event.accept) return {};
        if (
          event.revision !== editor.draft.revision ||
          !this.confirmationMatches(c)
        )
          throw Error("LARGE_EDIT_EXPIRED: paste or edit again");
        editor.edit(c.start, c.end, c.text, c.kind, true);
        return { changed: true };
      }
      case "select": {
        exact(event, ["type", "revision", "anchor", "head"]);
        if (!integer(event.anchor) || !integer(event.head))
          throw Error("INVALID_SELECTION");
        editor.select({ anchor: event.anchor, head: event.head }, true);
        return { selection: true };
      }
      case "move": {
        exact(event, ["type", "revision", "direction", "extend", "word"]);
        if (
          !["left", "right", "home", "end", "up", "down"].includes(
            String(event.direction),
          ) ||
          typeof event.extend !== "boolean" ||
          typeof event.word !== "boolean"
        )
          throw Error("INVALID_MOVEMENT");
        const text = flatten(editor.draft.nodes),
          { anchor, head } = editor.draft.selection;
        let next = head;
        const start = text.lastIndexOf("\n", head - 1) + 1,
          end = text.indexOf("\n", head);
        if (event.direction === "home") next = start;
        else if (event.direction === "end") next = end < 0 ? text.length : end;
        else if (event.direction === "up" || event.direction === "down") {
          const col = head - start;
          if (event.direction === "up") {
            const prev = text.lastIndexOf("\n", start - 2) + 1;
            next = Math.min(Math.max(0, start - 1), prev + col);
          } else if (end >= 0) {
            const following = text.indexOf("\n", end + 1);
            next = Math.min(
              following < 0 ? text.length : following,
              end + 1 + col,
            );
          }
        } else if (!event.extend && anchor !== head)
          next =
            event.direction === "left"
              ? Math.min(anchor, head)
              : Math.max(anchor, head);
        else if (event.word) {
          const words = new Intl.Segmenter("und", {
            granularity: "word",
          }).segment(text);
          if (event.direction === "left")
            next = head > 0 ? words.containing(head - 1)!.index : 0;
          else if (head < text.length) {
            const word = words.containing(head)!;
            next = word.index + word.segment.length;
          }
        } else
          next = editor.index.move(head, event.direction === "left" ? -1 : 1);
        const forward = !["left", "up", "home"].includes(
          String(event.direction),
        );
        next = editor.safePosition(next, forward);
        editor.select({ anchor: event.extend ? anchor : next, head: next });
        return { selection: true };
      }
      case "delete": {
        exact(event, ["type", "revision", "direction"]);
        if (!["backward", "forward"].includes(String(event.direction)))
          throw Error("INVALID_DELETE");
        const selection = { ...editor.draft.selection };
        const backward = event.direction === "backward";
        const other =
          selection.anchor === selection.head
            ? editor.safePosition(
                editor.index.move(selection.head, backward ? -1 : 1),
                !backward,
              )
            : selection.anchor;
        return this.insert("", "typed", editor.draft.revision, selection, {
          start: Math.min(other, selection.head),
          end: Math.max(other, selection.head),
        });
      }
      case "undo":
        exact(event, ["type", "revision", "redo"]);
        if (typeof event.redo !== "boolean") throw Error("INVALID_UNDO");
        editor.undo(event.redo);
        return { changed: true };
      case "paste-display":
        exact(event, ["type", "revision", "id", "expanded"]);
        if (typeof event.id !== "string" || typeof event.expanded !== "boolean")
          throw Error("INVALID_PASTE_DISPLAY");
        editor.togglePaste(event.id, event.expanded);
        return { changed: true };
      case "action": {
        exact(event, ["type", "revision", "action"]);
        if (
          ![
            "submit",
            "commands",
            "literal",
            "copy",
            "cut",
            "resume",
            "scroll-up",
            "scroll-down",
          ].includes(String(event.action))
        )
          throw Error("INVALID_ACTION");
        return { action: event.action as Action };
      }
      default:
        throw Error("UNSUPPORTED_INPUT_EVENT");
    }
  }
}
