import { flatten, type Draft } from "./editor.ts";
export type View = "Main" | "Task";
export const COMMANDS = [
  { name: "M", scope: "all", min: 0, max: 0, help: "Main" },
  {
    name: "T",
    scope: "all",
    min: 0,
    max: 0,
    help: "Task draft; operations arrive in #83",
  },
  { name: "help", scope: "all", min: 0, max: 1, help: "[command]" },
  { name: "send", scope: "all", min: 0, max: 0, help: "[literal text] → Main" },
  {
    name: "quit",
    scope: "all",
    min: 0,
    max: 0,
    help: "flush and close this client",
  },
  {
    name: "cotvisible",
    scope: "Main",
    min: 0,
    max: 2,
    help: "[message_id] [on|off]",
    alias: "cotv",
  },
  { name: "more", scope: "Main", min: 1, max: 1, help: "<message_id>" },
  { name: "latest", scope: "Main", min: 0, max: 0, help: "follow latest" },
  { name: "history", scope: "Main", min: 0, max: 1, help: "[before|after]" },
  { name: "select", scope: "Main", min: 1, max: 1, help: "<message_id>" },
  {
    name: "copy",
    scope: "Main",
    min: 1,
    max: 2,
    help: "<message_id> [loaded]",
  },
  {
    name: "pasteblock",
    scope: "all",
    min: 2,
    max: 2,
    help: "<id> <expand|collapse|edit|remove|copy>",
  },
  {
    name: "outbox",
    scope: "all",
    min: 0,
    max: 1,
    help: "[request_id|page:N|receipts:cursor]",
  },
  { name: "retry", scope: "all", min: 1, max: 1, help: "<request_id>" },
  {
    name: "discard",
    scope: "all",
    min: 1,
    max: 1,
    help: "<never-submitted or known-rejected request_id>",
  },
  {
    name: "cancel",
    scope: "reserved",
    min: 0,
    max: 0,
    help: "NOT_IMPLEMENTED (#83)",
  },
  {
    name: "attach",
    scope: "reserved",
    min: 0,
    max: 0,
    help: "NOT_IMPLEMENTED (#83)",
  },
  {
    name: "paste",
    scope: "reserved",
    min: 0,
    max: 0,
    help: "NOT_IMPLEMENTED (#83)",
  },
  {
    name: "open",
    scope: "reserved",
    min: 0,
    max: 0,
    help: "NOT_IMPLEMENTED (#83)",
  },
] as const;
export type Parsed =
  | { kind: "message"; text: string }
  | { kind: "command"; name: string; args: string[]; payload?: string };
export function aliasesOf(
  value: Record<string, string> = {},
): Record<string, string> {
  const names = new Set<string>(COMMANDS.map((x) => x.name));
  const aliases: Record<string, string> = { cotv: "cotvisible" };
  for (const [alias, name] of Object.entries(value)) {
    if (
      !/^[a-zA-Z][a-zA-Z0-9]*$/.test(alias) ||
      names.has(alias) ||
      alias in aliases ||
      !names.has(name)
    )
      throw Error("INVALID_ALIAS");
    aliases[alias] = name;
  }
  return aliases;
}
function words(text: string): string[] {
  if (/[\u0000-\u0008\u000a-\u001f\u007f-\u009f;|&<>`$]/.test(text))
    throw Error("INVALID_COMMAND_SYNTAX");
  const result: string[] = [];
  let word = "",
    quote = "",
    active = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\\") {
      const next = text[++i];
      if (!["'", '"', "\\"].includes(next)) throw Error("INVALID_ESCAPE");
      word += next;
      active = true;
    } else if (quote) {
      if (char === quote) quote = "";
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      active = true;
    } else if (char === " " || char === "\t") {
      if (active) {
        result.push(word);
        word = "";
        active = false;
      }
    } else {
      word += char;
      active = true;
    }
  }
  if (quote) throw Error("UNMATCHED_QUOTE");
  if (active) result.push(word);
  return result;
}
export function parseSubmission(
  draft: Draft,
  view: View,
  aliases = aliasesOf(),
): Parsed {
  const text = flatten(draft.nodes);
  if (
    draft.literal ||
    draft.nodes[0]?.kind !== "typed" ||
    !text.startsWith("/")
  )
    return { kind: "message", text };
  // Paste-origin characters cannot form any command token. /send's payload alone may include paste nodes.
  const prefix = /^\/([A-Za-z][A-Za-z0-9]*)/.exec(text);
  if (!prefix) throw Error("UNKNOWN_COMMAND");
  const name = aliases[prefix[1]] ?? prefix[1];
  const command = COMMANDS.find((x) => x.name === name);
  if (!command) throw Error("UNKNOWN_COMMAND");
  if (command.scope === "reserved") throw Error("NOT_IMPLEMENTED");
  if (command.scope !== "all" && command.scope !== view)
    throw Error("COMMAND_SCOPE");
  if (draft.nodes[0].text.length < prefix[0].length)
    throw Error("PASTED_COMMAND_TOKEN");
  const rest = text.slice(prefix[0].length);
  if (name === "send") {
    if (rest && !rest.startsWith(" ")) throw Error("INVALID_SEND_PREFIX");
    return {
      kind: "command",
      name,
      args: [],
      ...(rest ? { payload: rest.slice(1) } : {}),
    };
  }
  if (draft.nodes.some((x) => x.kind === "paste"))
    throw Error("PASTED_COMMAND_ARGUMENT");
  if (rest && !/^[ \t]/.test(rest)) throw Error("INVALID_COMMAND_SYNTAX");
  const args = words(rest);
  if (args.length < command.min || args.length > command.max)
    throw Error("COMMAND_ARGUMENTS");
  if (name === "history" && args[0] && !["before", "after"].includes(args[0]))
    throw Error("COMMAND_ARGUMENTS");
  if (name === "copy" && args[1] && args[1] !== "loaded")
    throw Error("COMMAND_ARGUMENTS");
  if (
    name === "pasteblock" &&
    !["expand", "collapse", "edit", "remove", "copy"].includes(args[1])
  )
    throw Error("COMMAND_ARGUMENTS");
  if (
    name === "cotvisible" &&
    args.length === 2 &&
    !["on", "off"].includes(args[1])
  )
    throw Error("COMMAND_ARGUMENTS");
  return { kind: "command", name, args };
}
export function resolveID(prefix: string, ids: string[]): string {
  const exact = ids.find((x) => x === prefix);
  if (exact) return exact;
  const candidates = ids.filter((x) => x.startsWith(prefix));
  if (!prefix || candidates.length !== 1)
    throw Error(candidates.length ? "AMBIGUOUS_ID" : "ID_NOT_FOUND");
  return candidates[0];
}
export function completions(
  prefix: string,
  view: View,
  ids: string[] = [],
  aliases = aliasesOf(),
): string[] {
  const names = COMMANDS.filter(
    (x) => x.scope === "all" || x.scope === view || x.scope === "reserved",
  ).map((x) => "/" + x.name);
  return [
    ...new Set([
      ...names,
      ...Object.keys(aliases).map((x) => "/" + x),
      ...ids,
      "on",
      "off",
      "before",
      "after",
      "loaded",
      "expand",
      "collapse",
      "edit",
      "remove",
      "copy",
    ]),
  ]
    .filter((x) => x.startsWith(prefix))
    .slice(0, 20);
}
