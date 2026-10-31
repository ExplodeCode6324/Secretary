import {
  Editor,
  CURSOR_MARKER,
  getKeybindings,
  matchesKey,
  type TUI,
  type AutocompleteProvider,
  type AutocompleteItem,
} from "@earendil-works/pi-tui";
import { EditorBridge } from "./editor-bridge.ts";
import {
  expandSnapshot,
  originAt,
  plainSnapshot,
  equalSnapshotContent,
  type DraftSnapshot,
} from "./draft.ts";

export type Page = "Main" | "Task";
export const commands = [
  "M",
  "T",
  "back",
  "help",
  "send",
  "rawmessage",
  "cotvisible",
  "cotv",
] as const;
export type Action =
  | { kind: "navigate"; page: Page }
  | { kind: "help" | "noop" | "draft" | "cot" }
  | { kind: "send"; text: string }
  | { kind: "error"; message: string };
export function parseInput(raw: string, page: Page): Action {
  if (!raw.startsWith("/"))
    return page === "Task" ? { kind: "draft" } : payload(raw);
  const match = /^\/([A-Za-z]+)([\s\S]*)$/.exec(raw);
  if (!match)
    return {
      kind: "error",
      message: "未知命令；字面正文请用 /rawmessage <正文>",
    };
  const [, name, rest] = match,
    command = name.toLowerCase();
  if (!commands.some((name) => name.toLowerCase() === command))
    return { kind: "error", message: "未知或尚未实现的命令；/help 查看范围" };
  if (command === "send" || command === "rawmessage") {
    if (page !== "Main")
      return { kind: "error", message: "此命令仅在 Main 可用；Task 草稿保留" };
    return rest.startsWith(" ")
      ? payload(rest.slice(1))
      : { kind: "error", message: "需要正文：/" + command + " <正文>" };
  }
  if (!/^[ \t]*$/.test(rest))
    return { kind: "error", message: "此命令不接受参数或额外行" };
  if (command === "cotvisible" || command === "cotv")
    return page === "Main"
      ? { kind: "cot" }
      : { kind: "error", message: "CoT 显示命令仅在 Main 可用；Task 草稿保留" };
  if (command === "m" || command === "t")
    return { kind: "navigate", page: command === "m" ? "Main" : "Task" };
  return { kind: command === "help" ? "help" : "noop" };
}
function payload(text: string): Action {
  return text.trim()
    ? { kind: "send", text }
    : { kind: "error", message: "正文不能为空" };
}
export function parseDraft(snapshot: DraftSnapshot, page: Page): Action {
  try {
    if (snapshot.text.startsWith("/")) {
      const source = originAt(snapshot, 0);
      if (source === "unknown")
        return {
          kind: "error",
          message:
            "原草稿命令来源未知；请重新键入开头 /，或加 /rawmessage 明确作为正文",
        };
      if (source === "paste")
        return page === "Task"
          ? { kind: "draft" }
          : payload(expandSnapshot(snapshot));
    }
    const action = parseInput(snapshot.text, page);
    if (action.kind !== "send") return action;
    return payload(
      expandSnapshot(snapshot, snapshot.text.length - action.text.length),
    );
  } catch (e) {
    return {
      kind: "error",
      message: "粘贴块无法展开，草稿已保留：" + String(e),
    };
  }
}
function isCompleteLocalCommand(raw: string) {
  return /^\/(?:m|t|back|help|cotvisible|cotv)[ \t]*$/i.test(raw);
}
export function commandCompletion(
  page: () => Page,
  typedSlash = () => true,
  applied?: (before: number, after: number) => void,
): AutocompleteProvider {
  return {
    triggerCharacters: ["/"],
    async getSuggestions(lines, line, col) {
      if (
        !typedSlash() ||
        line !== 0 ||
        isCompleteLocalCommand(lines.join("\n")) ||
        !/^\/[a-z]*$/i.test(lines[0].slice(0, col)) ||
        /\s/.test(lines[0])
      )
        return null;
      const prefix = lines[0].slice(0, col);
      const names = commands.filter(
        (n) =>
          (page() === "Main" ||
            !["send", "rawmessage", "cotvisible", "cotv"].includes(n)) &&
          ("/" + n).toLowerCase().startsWith(prefix.toLowerCase()),
      );
      return names.length
        ? {
            prefix,
            items: names.map((n) => ({ value: "/" + n, label: "/" + n })),
          }
        : null;
    },
    applyCompletion(lines, line, col, item: AutocompleteItem) {
      const value = item.value + " ";
      applied?.(lines[0].length, value.length);
      return {
        lines: [value, ...lines.slice(1)],
        cursorLine: 0,
        cursorCol: value.length,
      };
    },
    shouldTriggerFileCompletion: () => false,
  };
}
export const color = (n: string) => (s: string) => `\x1b[${n}m${s}\x1b[0m`;
export const editorTheme = {
  borderColor: color("90"),
  selectList: {
    selectedPrefix: color("96"),
    selectedText: color("96"),
    description: color("90"),
    scrollInfo: color("90"),
    noMatch: color("90"),
  },
};
export class DraftEditor extends Editor {
  readonly bridge: EditorBridge;
  enabled = true;
  private hiddenRows = 0;
  protected override renderTopBorder(width: number, hidden: number) {
    this.hiddenRows = hidden;
    return super.renderTopBorder(width, hidden);
  }
  onFirstVisualRow(width: number) {
    const rows = this.render(width);
    return this.hiddenRows === 0 && !!rows[1]?.includes(CURSOR_MARKER);
  }
  onExplicitSubmit?: (raw: string, snapshot?: DraftSnapshot) => void;
  onEdited?: (raw: string, snapshot: DraftSnapshot, changed: boolean) => void;
  onOperation?: () => void;
  constructor(tui: TUI, page: () => Page) {
    super(tui, editorTheme, { autocompleteMaxVisible: 6 });
    this.bridge = new EditorBridge(this);
    this.disableSubmit = true;
    this.setAutocompleteProvider(
      commandCompletion(
        page,
        () => originAt(this.bridge.document, 0) === "typed",
        (a, b) => this.bridge.claimCompletion(a, b),
      ),
    );
  }
  snapshot() {
    return this.bridge.document.snapshot(this.getText(), this.getCursor());
  }
  restore(snapshot: DraftSnapshot, clearHistory = true) {
    this.bridge.restore(snapshot, (text) => super.setText(text), clearHistory);
  }
  override setText(text: string) {
    this.restore(plainSnapshot(text));
  }
  override getExpandedText() {
    return expandSnapshot(this.snapshot());
  }
  override handleMouse(event: Parameters<Editor["handleMouse"]>[0]) {
    if (!this.enabled) return;
    const before = this.snapshot();
    this.bridge.begin();
    const result = super.handleMouse(event);
    this.bridge.finish();
    const snapshot = this.snapshot();
    let raw = snapshot.text;
    try {
      raw = expandSnapshot(snapshot);
    } catch {
      /* Preserve damaged snapshots. */
    }
    this.onEdited?.(raw, snapshot, !equalSnapshotContent(before, snapshot));
    return result;
  }
  override handleInput(data: string) {
    if (!this.enabled) return;
    this.onOperation?.();
    const before = this.getText();
    const beforeSnapshot = this.snapshot();
    this.bridge.begin(true);
    if (data.startsWith("\x1b[200~")) {
      if (!data.endsWith("\x1b[201~")) return;
      const paste = this.bridge.document.paste(data.slice(6, -6));
      this.bridge.insert(paste.text, paste.ranges);
    } else if (matchesKey(data, "shift+enter")) {
      // An open menu consumes the gesture as completion, never as a send.
      if (this.isShowingAutocomplete() && !isCompleteLocalCommand(before))
        super.handleInput("\r");
      else {
        if (this.isShowingAutocomplete()) super.handleInput("\x1b");
        const snapshot = this.snapshot();
        let raw = snapshot.text;
        try {
          raw = expandSnapshot(snapshot);
        } catch {
          /* parseDraft reports the local error. */
        }
        this.onExplicitSubmit?.(raw, snapshot);
        return;
      }
    } else if (this.isShowingAutocomplete() && matchesKey(data, "enter"))
      super.handleInput(data);
    else if (
      matchesKey(data, "enter") ||
      data === "\n" ||
      getKeybindings().matches(data, "tui.input.newLine")
    )
      this.bridge.insert("\n", []);
    else super.handleInput(data);
    this.bridge.finish(matchesKey(data, "left") || matchesKey(data, "right"));
    const after = this.getText();
    if (isCompleteLocalCommand(after) && this.isShowingAutocomplete())
      super.handleInput("\x1b");
    const snapshot = this.snapshot();
    let raw = after;
    try {
      raw = expandSnapshot(snapshot);
    } catch {
      /* Keep the resumable snapshot even if a block is damaged. */
    }
    this.onEdited?.(
      raw,
      snapshot,
      !equalSnapshotContent(beforeSnapshot, snapshot),
    );
  }
}
export function configureKeys() {
  getKeybindings().setUserBindings({
    "tui.altScreen.search": [],
    "tui.altScreen.top": [],
    "tui.altScreen.bottom": [],
    "tui.altScreen.previousPrompt": [],
    "tui.altScreen.nextPrompt": [],
  });
}
