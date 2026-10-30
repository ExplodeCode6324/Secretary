import {
  Editor,
  getKeybindings,
  matchesKey,
  type TUI,
  type AutocompleteProvider,
  type AutocompleteItem,
} from "@earendil-works/pi-tui";

export type Page = "Main" | "Task";
export const commands = [
  "M",
  "T",
  "back",
  "help",
  "send",
  "rawmessage",
] as const;
export type Action =
  | { kind: "navigate"; page: Page }
  | { kind: "help" | "noop" | "draft" }
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
  if (!["m", "t", "back", "help", "send", "rawmessage"].includes(command))
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
  if (command === "m" || command === "t")
    return { kind: "navigate", page: command === "m" ? "Main" : "Task" };
  return { kind: command === "help" ? "help" : "noop" };
}
function payload(text: string): Action {
  return text.trim()
    ? { kind: "send", text }
    : { kind: "error", message: "正文不能为空" };
}
export function commandCompletion(page: () => Page): AutocompleteProvider {
  return {
    triggerCharacters: ["/"],
    async getSuggestions(lines, line, col) {
      if (
        line !== 0 ||
        !/^\/[a-z]*$/i.test(lines[0].slice(0, col)) ||
        /\s/.test(lines[0])
      )
        return null;
      const prefix = lines[0].slice(0, col);
      const names = commands.filter(
        (n) =>
          (page() === "Main" || !["send", "rawmessage"].includes(n)) &&
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
  enabled = true;
  onExplicitSubmit?: (raw: string) => void;
  onEdited?: (raw: string) => void;
  onOperation?: () => void;
  constructor(tui: TUI, page: () => Page) {
    super(tui, editorTheme, { autocompleteMaxVisible: 6 });
    this.disableSubmit = true;
    this.setAutocompleteProvider(commandCompletion(page));
  }
  override handleInput(data: string) {
    if (!this.enabled) return;
    this.onOperation?.();
    const before = this.getExpandedText();
    if (data.startsWith("\x1b[200~")) super.handleInput(data);
    else if (matchesKey(data, "shift+enter")) {
      // An open menu consumes the gesture as completion, never as a send.
      if (this.isShowingAutocomplete()) super.handleInput("\r");
      else {
        this.onExplicitSubmit?.(before);
        return;
      }
    } else if (this.isShowingAutocomplete() && matchesKey(data, "enter"))
      super.handleInput(data);
    else if (
      matchesKey(data, "enter") ||
      data === "\n" ||
      getKeybindings().matches(data, "tui.input.newLine")
    )
      this.insertTextAtCursor("\n");
    else super.handleInput(data);
    const after = this.getExpandedText();
    if (after !== before) this.onEdited?.(after);
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
