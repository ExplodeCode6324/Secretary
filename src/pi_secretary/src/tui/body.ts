import type { CoreClient } from "../core-client.ts";
import type { Message } from "../api/contracts.ts";

export const ASSEMBLY_BYTES = 1024 * 1024;
export const WINDOW_FRAGMENTS = 8;
// Core v1 treats route identifiers literally; ':' is legal in a path segment.
// Encoding the message: prefix changes the signed body-cursor scope.
export const messagePath = (id: string) =>
  encodeURIComponent(id).replaceAll("%3A", ":");
export type Region = "body" | "thinking";
export type RegionWindow = {
  text: string;
  start: number;
  firstFragment: number;
  nextFragment: number;
  before: boolean;
  after: boolean;
  prefix: string;
};
export type MessageBody = {
  mode: boolean;
  message: Message;
  body: RegionWindow;
  thinking: RegionWindow;
  windowed: boolean;
};

/** Bounded context while walking discarded prefix fragments, including split fence lines. */
export class MarkdownPrefix {
  private line = "";
  private oversizedLine = false;
  private fence?: { marker: string; count: number; opening: string };
  private list: { indentation: number; opening: string }[] = [];
  private references = new Map<string, string>();
  private referenceBytes = 0;
  feed(text: string) {
    for (const character of text) {
      if (character === "\n") {
        this.acceptLine(this.line, this.oversizedLine);
        this.line = "";
        this.oversizedLine = false;
      } else if (this.line.length < 4096) this.line += character;
      else this.oversizedLine = true;
    }
  }
  private acceptLine(line: string, oversized: boolean) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (this.fence) {
      if (
        fence &&
        fence[1][0] === this.fence.marker &&
        fence[1].length >= this.fence.count &&
        !fence[2].trim()
      )
        this.fence = undefined;
      return;
    }
    if (fence) {
      this.fence = {
        marker: fence[1][0],
        count: fence[1].length,
        opening: line,
      };
      return;
    }
    if (!oversized) {
      const reference = /^ {0,3}\[([^\]]+)\]:\s+\S/.exec(line);
      if (reference && !this.references.has(reference[1])) {
        const bytes = Buffer.byteLength(line);
        if (this.referenceBytes + bytes > 65536)
          throw Error("MARKDOWN_CONTEXT_EXCEEDS_BUDGET");
        this.references.set(reference[1], line);
        this.referenceBytes += bytes;
      }
    }
    const list = /^(\s*)(?:[-+*]|\d+[.)])\s+/.exec(line);
    if (list) {
      const indentation = list[1].length;
      this.list = this.list.filter((entry) => entry.indentation < indentation);
      this.list.push({ indentation, opening: list[0] });
    } else if (line.trim() && !/^\s+/.test(line)) this.list = [];
  }
  prefix() {
    const definitions = [...this.references.values()].join("\n");
    // An unfinished prefix line is deliberately not replayed as user text.
    const context =
      this.fence?.opening ?? this.list.map((entry) => entry.opening).join("\n");
    return (
      (definitions ? definitions + "\n\n" : "") +
      (context ? context + "\n" : "")
    );
  }
}

function region(): RegionWindow {
  return {
    text: "",
    start: 0,
    firstFragment: 0,
    nextFragment: 0,
    before: false,
    after: false,
    prefix: "",
  };
}
type Collector = {
  window: RegionWindow;
  count: number;
  offset: number;
  prefix: MarkdownPrefix;
  done: boolean;
};

/** Reads a coherent revision, never publishes half of a stale cursor chain. */
export async function readMessageBody(
  client: Pick<CoreClient, "query">,
  first: Message,
  thinking: boolean,
  options: {
    targets?: Partial<Record<Region, number>>;
    windowed?: boolean;
    valid?: () => boolean;
  } = {},
): Promise<MessageBody> {
  const collectors: Record<Region, Collector> = {
    body: {
      window: region(),
      count: 0,
      offset: 0,
      prefix: new MarkdownPrefix(),
      done: false,
    },
    thinking: {
      window: region(),
      count: 0,
      offset: 0,
      prefix: new MarkdownPrefix(),
      done: !thinking,
    },
  };
  let completeText = "",
    completeThinking = "",
    bytes = 0;
  let windowed = options.windowed ?? false;
  let part = first;
  const valid = options.valid ?? (() => true);
  while (true) {
    if (!valid()) throw Error("BODY_SUPERSEDED");
    if (part.id !== first.id || part.revision !== first.revision)
      throw Error("CURSOR_EXPIRED");
    const nextBytes =
      Buffer.byteLength(part.text) + Buffer.byteLength(part.thinking ?? "");
    if (!windowed && bytes + nextBytes <= ASSEMBLY_BYTES) {
      completeText += part.text;
      completeThinking += part.thinking ?? "";
      bytes += nextBytes;
    } else {
      windowed = true;
      completeText = completeThinking = "";
    }
    for (const name of ["body", "thinking"] as const) {
      const c = collectors[name],
        value = name === "body" ? part.text : (part.thinking ?? "");
      const target = options.targets?.[name] ?? 0;
      if (!value) {
        c.done = true;
        continue;
      }
      c.done = false;
      if (c.count < target) c.prefix.feed(value);
      else if (c.count < target + WINDOW_FRAGMENTS) {
        if (c.count === target) {
          c.window.start = c.offset;
          c.window.firstFragment = target;
          c.window.prefix = c.prefix.prefix();
          c.window.before = target > 0;
        }
        c.window.text += value;
        c.window.nextFragment = c.count + 1;
      } else c.window.after = true;
      c.offset += value.length;
      c.count++;
    }
    if (!part.next_cursor) break;
    if (!windowed && bytes === ASSEMBLY_BYTES) {
      windowed = true;
      completeText = completeThinking = "";
    }
    if (
      windowed &&
      Object.values(collectors).every((c) => c.done || c.window.after)
    )
      break;
    const cursor = part.next_cursor;
    part = await client.query<Message>(
      `messages/${messagePath(first.id)}/content?streaming=true&thinking=${thinking}&cursor=${encodeURIComponent(cursor)}`,
    );
    if (part.next_cursor === cursor) throw Error("BODY_CURSOR_DID_NOT_ADVANCE");
  }
  if (!valid()) throw Error("BODY_SUPERSEDED");
  if (!windowed) {
    collectors.body.window = { ...region(), text: completeText };
    collectors.thinking.window = { ...region(), text: completeThinking };
  }
  const body = collectors.body.window,
    thought = collectors.thinking.window;
  return {
    mode: thinking,
    message: {
      ...first,
      text: body.text,
      ...(thinking ? { thinking: thought.text } : {}),
      next_cursor: null,
    },
    body,
    thinking: thought,
    windowed,
  };
}
