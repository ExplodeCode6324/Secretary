import { randomUUID } from "node:crypto";

export const DRAFT_BYTES = 4 * 1024 * 1024;
export const UNDO_BYTES = 512 * 1024;
export type TextNode = {
  id: string;
  kind: "typed" | "paste";
  text: string;
  expanded: boolean;
};
export type Selection = { anchor: number; head: number };
export type Draft = {
  revision: number;
  nodes: TextNode[];
  selection: Selection;
  literal: boolean;
  attachment_ids: string[];
};
export type Undo = {
  start: number;
  removed: TextNode[];
  inserted: TextNode[];
  before: Selection;
  after: Selection;
  bytes: number;
};
export type EditorState = { draft: Draft; undo: Undo[]; redo: Undo[] };
export const canonicalText = (text: string) => text.replace(/\r\n?/g, "\n");
export const flatten = (nodes: TextNode[]) => nodes.map((n) => n.text).join("");
export const emptyDraft = (): Draft => ({
  revision: 0,
  nodes: [],
  selection: { anchor: 0, head: 0 },
  literal: false,
  attachment_ids: [],
});
const bytes = (nodes: TextNode[]) => Buffer.byteLength(flatten(nodes));
const fragment = (node: TextNode, text: string): TextNode => ({
  ...node,
  id: text === node.text ? node.id : randomUUID(),
  text,
});

/** UTF-16 offsets are accepted only at extended-grapheme boundaries. */
export function boundaries(text: string): number[] {
  const offsets: number[] = [];
  // Retain offsets only, rather than a second array of every segment object.
  for (const part of new Intl.Segmenter("und", {
    granularity: "grapheme",
  }).segment(text))
    offsets.push(part.index);
  offsets.push(text.length);
  return offsets;
}
/** Full-text ICU context with indexed lookup; no fixed Unicode look-behind window. */
export class GraphemeIndex {
  private segments: Intl.Segments;
  constructor(readonly text: string) {
    this.segments = new Intl.Segmenter("und", {
      granularity: "grapheme",
    }).segment(text);
  }
  has(position: number): boolean {
    return (
      Number.isSafeInteger(position) &&
      position >= 0 &&
      position <= this.text.length &&
      (position === 0 ||
        position === this.text.length ||
        this.segments.containing(position)?.index === position)
    );
  }
  snap(position: number, forward: boolean): number {
    if (position <= 0) return 0;
    if (position >= this.text.length) return this.text.length;
    const part = this.segments.containing(position)!;
    return part.index === position || !forward
      ? part.index
      : part.index + part.segment.length;
  }
  move(position: number, count: number): number {
    while (count < 0 && position > 0) {
      position = this.segments.containing(position - 1)!.index;
      count++;
    }
    while (count > 0 && position < this.text.length) {
      const part = this.segments.containing(position)!;
      position = part.index + part.segment.length;
      count--;
    }
    return position;
  }
  window(position: number, before = 2000, after = 2000) {
    return {
      from: this.move(position, -before),
      to: this.move(position, after),
    };
  }
}
export function validText(text: unknown): asserts text is string {
  if (
    typeof text !== "string" ||
    Buffer.from(text, "utf8").toString("utf8") !== text
  )
    throw Error("INVALID_TEXT");
}
export function validateDraft(value: Draft): void {
  if (
    !value ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Array.isArray(value.nodes) ||
    value.nodes.length > 10000 ||
    typeof value.literal !== "boolean" ||
    !Array.isArray(value.attachment_ids) ||
    value.attachment_ids.length > 4
  )
    throw Error("CORRUPT_DRAFT");
  const ids = new Set<string>();
  for (const node of value.nodes) {
    if (
      !node ||
      !/^[a-f0-9-]{36}$/.test(node.id) ||
      ids.has(node.id) ||
      !["typed", "paste"].includes(node.kind) ||
      typeof node.expanded !== "boolean"
    )
      throw Error("CORRUPT_NODE");
    validText(node.text);
    ids.add(node.id);
  }
  if (bytes(value.nodes) > DRAFT_BYTES) throw Error("DRAFT_TOO_LARGE");
  const index = new GraphemeIndex(flatten(value.nodes));
  if (
    !value.selection ||
    !index.has(value.selection.anchor) ||
    !index.has(value.selection.head)
  )
    throw Error("INVALID_SELECTION");
}

function split(nodes: TextNode[], position: number): [TextNode[], TextNode[]] {
  const left: TextNode[] = [],
    right: TextNode[] = [];
  let cursor = 0;
  for (const node of nodes) {
    const cut = Math.max(0, Math.min(node.text.length, position - cursor));
    if (cut) left.push(fragment(node, node.text.slice(0, cut)));
    if (cut < node.text.length)
      right.push(fragment(node, node.text.slice(cut)));
    cursor += node.text.length;
  }
  return [left, right];
}
function compact(nodes: TextNode[]): TextNode[] {
  const out: TextNode[] = [];
  for (const node of nodes) {
    if (!node.text) continue;
    const last = out.at(-1);
    if (node.kind === "typed" && last?.kind === "typed")
      out[out.length - 1] = {
        ...last,
        id: randomUUID(),
        text: last.text + node.text,
      };
    else out.push(node);
  }
  if (out.length > 10000) throw Error("NODE_LIMIT");
  return out;
}
/** Only this model creates source tags. Browser snapshots never replace it. */
export class Editor {
  draft: Draft;
  private undoStack: Undo[] = [];
  private redoStack: Undo[] = [];
  private indexedNodes?: TextNode[];
  private indexed?: GraphemeIndex;
  get index(): GraphemeIndex {
    if (this.indexedNodes !== this.draft.nodes) {
      this.indexedNodes = this.draft.nodes;
      this.indexed = new GraphemeIndex(flatten(this.draft.nodes));
    }
    return this.indexed!;
  }
  constructor(draft = emptyDraft(), recoverSelection = false) {
    const selection = draft.selection;
    validateDraft(
      recoverSelection
        ? { ...draft, selection: { anchor: 0, head: 0 } }
        : draft,
    );
    this.draft = structuredClone(draft);
    if (recoverSelection) {
      if (
        !selection ||
        [selection.anchor, selection.head].some(
          (p) =>
            !Number.isSafeInteger(p) || p < 0 || p > this.index.text.length,
        )
      )
        throw Error("INVALID_SELECTION");
      const forward = selection.head >= selection.anchor;
      const repaired =
        selection.anchor === selection.head
          ? {
              anchor: this.safePosition(selection.head, true),
              head: this.safePosition(selection.head, true),
            }
          : {
              anchor: this.safePosition(selection.anchor, !forward),
              head: this.safePosition(selection.head, forward),
            };
      if (
        repaired.anchor !== selection.anchor ||
        repaired.head !== selection.head
      )
        this.draft.revision++;
      this.draft.selection = repaired;
    }
  }
  snapshot(): EditorState {
    return structuredClone({
      draft: this.draft,
      undo: this.undoStack,
      redo: this.redoStack,
    });
  }
  static restore(value: EditorState): Editor {
    const editor = new Editor(value.draft, true);
    if (
      !Array.isArray(value.undo) ||
      !Array.isArray(value.redo) ||
      value.undo.length + value.redo.length > 20 ||
      [...value.undo, ...value.redo].reduce((sum, x) => sum + x.bytes, 0) >
        UNDO_BYTES
    )
      throw Error("CORRUPT_UNDO");
    for (const operation of [...value.undo, ...value.redo]) {
      if (
        !Number.isSafeInteger(operation.start) ||
        operation.start < 0 ||
        !Number.isSafeInteger(operation.bytes) ||
        operation.bytes < 0
      )
        throw Error("CORRUPT_UNDO");
      for (const nodes of [operation.removed, operation.inserted])
        validateDraft({ ...emptyDraft(), nodes });
      for (const selection of [operation.before, operation.after]) {
        if (
          !selection ||
          !Number.isSafeInteger(selection.anchor) ||
          selection.anchor < 0 ||
          !Number.isSafeInteger(selection.head) ||
          selection.head < 0
        )
          throw Error("CORRUPT_UNDO");
      }
      if (
        operation.bytes !==
        bytes(operation.removed) + bytes(operation.inserted)
      )
        throw Error("CORRUPT_UNDO");
    }
    editor.undoStack = structuredClone(value.undo);
    editor.redoStack = structuredClone(value.redo);
    return editor;
  }
  private range(start: number, end: number) {
    if (start > end || !this.index.has(start) || !this.index.has(end))
      throw Error("INVALID_RANGE");
    let at = 0;
    for (const node of this.draft.nodes) {
      if (
        node.kind === "paste" &&
        !node.expanded &&
        ((start > at && start < at + node.text.length) ||
          (end > at && end < at + node.text.length))
      )
        throw Error("EXPAND_PASTE_FIRST");
      at += node.text.length;
    }
  }
  select(selection: Selection, fromPointer = false): void {
    if (fromPointer) {
      const length = flatten(this.draft.nodes).length;
      if (
        [selection.anchor, selection.head].some(
          (p) => !Number.isSafeInteger(p) || p < 0 || p > length,
        )
      )
        throw Error("INVALID_RANGE");
      // Rendered provenance runs can meet inside one grapheme. Pointer offsets
      // are positions to snap; edit transaction ranges remain strictly validated.
      if (selection.anchor === selection.head) {
        const position = this.safePosition(selection.head, true);
        selection = { anchor: position, head: position };
      } else {
        const forward = selection.head > selection.anchor;
        selection = {
          anchor: this.safePosition(selection.anchor, !forward),
          head: this.safePosition(selection.head, forward),
        };
      }
    }
    this.range(
      Math.min(selection.anchor, selection.head),
      Math.max(selection.anchor, selection.head),
    );
    if (
      selection.anchor !== this.draft.selection.anchor ||
      selection.head !== this.draft.selection.head
    )
      this.draft.revision++;
    this.draft.selection = { ...selection };
  }
  /** Joining text may create a grapheme across a provenance boundary. */
  safePosition(position: number, forward: boolean): number {
    let point = this.index.snap(position, forward),
      offset = 0;
    const collapsed: Array<{ start: number; end: number }> = [];
    for (const node of this.draft.nodes) {
      if (node.kind === "paste" && !node.expanded)
        collapsed.push({ start: offset, end: offset + node.text.length });
      offset += node.text.length;
    }
    for (const block of forward ? collapsed : collapsed.reverse())
      if (point > block.start && point < block.end)
        point = this.index.snap(forward ? block.end : block.start, forward);
    return point;
  }
  typedRange(start: number, end: number): boolean {
    let at = 0;
    for (const node of this.draft.nodes) {
      const next = at + node.text.length;
      if (node.kind === "paste" && start < next && end > at) return false;
      at = next;
    }
    return true;
  }
  private replace(start: number, end: number, nodes: TextNode[]): TextNode[] {
    const [left, tail] = split(this.draft.nodes, start);
    const [removed, right] = split(tail, end - start);
    const next = compact([...left, ...nodes, ...right]);
    if (bytes(next) > DRAFT_BYTES) throw Error("DRAFT_TOO_LARGE");
    this.draft.nodes = next;
    this.draft.revision++;
    return removed;
  }
  edit(
    start: number,
    end: number,
    text: string,
    kind: "typed" | "paste",
    allowNonUndoable = false,
  ): void {
    validText(text);
    this.range(start, end);
    text = canonicalText(text);
    const [, tail] = split(this.draft.nodes, start),
      [removed] = split(tail, end - start);
    // Text inserted inside an expanded paste is still paste-derived, even via a typed edit.
    let at = 0;
    for (const node of this.draft.nodes) {
      if (node.kind === "paste" && start > at && start < at + node.text.length)
        kind = "paste";
      at += node.text.length;
    }
    const inserted: TextNode[] = text
      ? [
          {
            id: randomUUID(),
            kind,
            text,
            expanded: kind === "typed" || !text.includes("\n"),
          },
        ]
      : [];
    // Consent cannot make an over-capacity edit valid. This preflight is
    // byte-only and leaves the canonical model and undo state untouched.
    if (
      bytes(this.draft.nodes) - bytes(removed) + bytes(inserted) >
      DRAFT_BYTES
    )
      throw Error("DRAFT_TOO_LARGE");
    const cost = bytes(removed) + bytes(inserted);
    if (cost > UNDO_BYTES && !allowNonUndoable)
      throw Error("NON_UNDOABLE_CONFIRMATION_REQUIRED");
    const before = { ...this.draft.selection };
    this.replace(start, end, inserted);
    const head = this.safePosition(start + text.length, true);
    const after = { anchor: head, head };
    this.draft.selection = after;
    this.redoStack = [];
    if (cost > UNDO_BYTES) this.undoStack = [];
    else {
      this.undoStack.push({
        start,
        removed,
        inserted,
        before,
        after,
        bytes: cost,
      });
      while (
        this.undoStack.length > 20 ||
        this.undoStack.reduce((sum, x) => sum + x.bytes, 0) > UNDO_BYTES
      )
        this.undoStack.shift();
    }
  }
  insert(text: string, kind: "typed" | "paste", allowNonUndoable = false) {
    const { anchor, head } = this.draft.selection;
    this.edit(
      Math.min(anchor, head),
      Math.max(anchor, head),
      text,
      kind,
      allowNonUndoable,
    );
  }
  undo(redo = false) {
    const source = redo ? this.redoStack : this.undoStack;
    const operation = source.at(-1);
    if (!operation) return;
    const old = redo ? operation.removed : operation.inserted,
      next = redo ? operation.inserted : operation.removed;
    this.replace(
      operation.start,
      operation.start + flatten(old).length,
      structuredClone(next),
    );
    const selection = redo ? operation.after : operation.before;
    const forward = selection.head >= selection.anchor;
    this.draft.selection =
      selection.anchor === selection.head
        ? {
            anchor: this.safePosition(selection.head, true),
            head: this.safePosition(selection.head, true),
          }
        : {
            anchor: this.safePosition(selection.anchor, !forward),
            head: this.safePosition(selection.head, forward),
          };
    source.pop();
    (redo ? this.undoStack : this.redoStack).push(operation);
  }
  togglePaste(id: string, expanded: boolean) {
    const node = this.draft.nodes.find(
      (n) => n.id === id && n.kind === "paste",
    );
    if (!node) throw Error("PASTE_NOT_FOUND");
    node.expanded = expanded;
    if (!expanded) {
      const selection = this.draft.selection;
      const forward = selection.head >= selection.anchor;
      selection.anchor = this.safePosition(selection.anchor, !forward);
      selection.head = this.safePosition(selection.head, forward);
    }
    this.draft.revision++;
  }
  selectedText() {
    const { anchor, head } = this.draft.selection;
    return flatten(this.draft.nodes).slice(
      Math.min(anchor, head),
      Math.max(anchor, head),
    );
  }
  /** A clipboard ACK cannot delete a changed revision or another selection. */
  cutAfterCopy(revision: number, selection: Selection, succeeded: boolean) {
    if (!succeeded) throw Error("CLIPBOARD_FAILED");
    if (
      revision !== this.draft.revision ||
      selection.anchor !== this.draft.selection.anchor ||
      selection.head !== this.draft.selection.head
    )
      throw Error("STALE_CUT");
    this.insert("", "typed");
  }
  protectedNodes(): TextNode[] {
    return [...this.undoStack, ...this.redoStack].flatMap((x) => [
      ...x.inserted,
      ...x.removed,
    ]);
  }
}

export function displayText(text: string): string {
  // Stored/request strings are never changed by display sanitation.
  return text.replace(
    /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
    (char) => `⟨${char.codePointAt(0)!.toString(16).padStart(4, "0")}⟩`,
  );
}
