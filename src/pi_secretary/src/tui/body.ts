import { setImmediate } from "node:timers/promises";
import type { CoreClient } from "../core-client.ts";
import type { Message } from "../api/contracts.ts";
import { WindowStream, type MarkdownWindow } from "./markdown-window.ts";

export const ASSEMBLY_BYTES = 1024 * 1024;
export const WINDOW_FRAGMENTS = 8; // target, not a cut boundary; §13 permits complete blocks up to 1 MiB.
export const messagePath = (id: string) =>
  encodeURIComponent(id).replaceAll("%3A", ":");
export type Region = "body" | "thinking";
type Frame = {
  cursor: string | null;
  frame: number;
  body: number;
  thinking: number;
};
type Checkpoint = Frame & {
  start: number;
  previousStart: number;
  context?: Pick<MarkdownWindow, "prefix" | "code" | "boundary" | "indent">;
};
export type RegionIndex = {
  length: number;
  lastMathStart: number;
  definitions: string;
  overflow: boolean;
  checkpoints: Checkpoint[];
};
export type RegionWindow = {
  text: string;
  start: number;
  previousStart: number;
  nextStart: number;
  before: boolean;
  after: boolean;
  prefix: string;
  suffix: string;
  definitions: string;
  contextBoundary: boolean;
  code: boolean;
  futureMath?: boolean;
  lastMathStart?: number;
  blocks?: MarkdownWindow["blocks"];
  trimCodeStart?: boolean;
  trimCodeEnd?: boolean;
};
export type MessageBody = {
  mode: boolean;
  message: Message;
  body: RegionWindow;
  thinking: RegionWindow;
  windowed: boolean;
  index?: Record<Region, RegionIndex>;
};
function region(text = ""): RegionWindow {
  return {
    text,
    start: 0,
    previousStart: 0,
    nextStart: text.length,
    before: false,
    after: false,
    prefix: "",
    suffix: "",
    definitions: "",
    contextBoundary: false,
    code: false,
  };
}
function index(): RegionIndex {
  return {
    length: 0,
    lastMathStart: -1,
    definitions: "",
    overflow: false,
    checkpoints: [],
  };
}
function resultWindow(
  selected: MarkdownWindow | undefined,
  info: RegionIndex,
): RegionWindow {
  if (!selected) return region();
  return {
    ...region(),
    ...selected,
    prefix: selected.prefix ?? "",
    suffix: selected.suffix ?? "",
    before: selected.start > 0,
    after: selected.nextStart < info.length,
    definitions: info.definitions,
    futureMath: info.lastMathStart >= selected.nextStart,
    lastMathStart: info.lastMathStart,
    contextBoundary: !!selected.boundary || info.overflow,
    code: !!selected.code,
  };
}
function point(points: Checkpoint[], value: Checkpoint) {
  // A pathological fence info line must not multiply the retained context budget.
  if (Buffer.byteLength(value.context?.prefix ?? "") > 4096) return;
  const old = points.findIndex((p) => p.start === value.start);
  if (old >= 0) points.splice(old, 1);
  points.push(value);
  while (points.length > 32)
    points.splice(
      points.findIndex((p) => p.start !== 0),
      1,
    );
}

/** Cursor chains are coherent for a revision. No partial chain becomes visible. */
export async function readMessageBody(
  client: Pick<CoreClient, "query">,
  first: Message,
  thinking: boolean,
  options: {
    targets?: Partial<Record<Region, number>>;
    windowed?: boolean;
    valid?: () => boolean;
    previous?: MessageBody;
    contentPath?: string;
  } = {},
): Promise<MessageBody> {
  const valid = options.valid ?? (() => true);
  const query = async (cursor: string) => {
    if (!valid()) throw Error("BODY_SUPERSEDED");
    const part = await client.query<Message>(
      `${options.contentPath ?? `messages/${messagePath(first.id)}/content?streaming=true`}${options.contentPath?.includes("?") || !options.contentPath ? "&" : "?"}thinking=${thinking}&cursor=${encodeURIComponent(cursor)}`,
    );
    if (!valid()) throw Error("BODY_SUPERSEDED");
    if (part.id !== first.id || part.revision !== first.revision)
      throw Error("CURSOR_EXPIRED");
    if (part.next_cursor === cursor) throw Error("BODY_CURSOR_DID_NOT_ADVANCE");
    return part;
  };
  const previous = options.previous;
  if (
    previous?.index &&
    previous.mode === thinking &&
    previous.message.revision === first.revision
  ) {
    const windows = { body: previous.body, thinking: previous.thinking };
    const indexes = {
      body: {
        ...previous.index.body,
        checkpoints: [...previous.index.body.checkpoints],
      },
      thinking: {
        ...previous.index.thinking,
        checkpoints: [...previous.index.thinking.checkpoints],
      },
    };
    for (const name of ["body", "thinking"] as const) {
      if (name === "thinking" && !thinking) continue;
      const target = options.targets?.[name] ?? windows[name].start;
      if (target === windows[name].start) continue;
      const info = indexes[name];
      const origin = [...info.checkpoints]
        .sort((a, b) => b.start - a.start)
        .find((p) => p.start <= target) ?? {
        cursor: null,
        frame: 0,
        body: 0,
        thinking: 0,
        start: 0,
        previousStart: 0,
      };
      let frame: Frame = origin,
        part = origin.cursor ? await query(origin.cursor) : first;
      const frames: Frame[] = [];
      const reader = new WindowStream(
        target,
        (window) => {
          const checkpoint = [...frames]
            .reverse()
            .find((f) => f[name] <= window.start);
          if (checkpoint)
            point(info.checkpoints, {
              ...checkpoint,
              start: window.start,
              previousStart: window.previousStart,
              context: {
                prefix: window.prefix,
                code: window.code,
                boundary: window.boundary,
                indent: window.indent,
              },
            });
        },
        origin.start,
        origin.previousStart,
        undefined,
        undefined,
        origin.context,
      );
      while (true) {
        if (!valid()) throw Error("BODY_SUPERSEDED");
        frames.push(frame);
        if (frames.length > 256) frames.shift();
        const text = name === "body" ? part.text : (part.thinking ?? "");
        reader.feed(text.slice(Math.max(0, origin.start - frame[name])));
        if (reader.selected) break;
        if (!part.next_cursor) {
          reader.finish();
          break;
        }
        frame = {
          cursor: part.next_cursor,
          frame: frame.frame + 1,
          body: frame.body + part.text.length,
          thinking: frame.thinking + (part.thinking?.length ?? 0),
        };
        part = await query(part.next_cursor);
      }
      windows[name] = resultWindow(reader.selected, info);
    }
    return assemble(
      first,
      thinking,
      windows.body,
      windows.thinking,
      true,
      indexes,
    );
  }
  const indexes = { body: index(), thinking: index() };
  const frames: Frame[] = [];
  let readers: Record<Region, WindowStream> | undefined;
  const makeReader = (name: Region) =>
    new WindowStream(options.targets?.[name] ?? 0, (window) => {
      const checkpoint = [...frames]
        .reverse()
        .find((f) => f[name] <= window.start);
      if (checkpoint)
        point(indexes[name].checkpoints, {
          ...checkpoint,
          start: window.start,
          previousStart: window.previousStart,
          context: {
            prefix: window.prefix,
            code: window.code,
            boundary: window.boundary,
            indent: window.indent,
          },
        });
    });
  let completeText = "",
    completeThinking = "",
    bytes = 0;
  let part = first,
    frame: Frame = { cursor: null, frame: 0, body: 0, thinking: 0 };
  while (true) {
    if (!valid()) throw Error("BODY_SUPERSEDED");
    if (part.id !== first.id || part.revision !== first.revision)
      throw Error("CURSOR_EXPIRED");
    frames.push(frame);
    if (frames.length > 256) frames.shift();
    const thought = thinking ? (part.thinking ?? "") : "";
    const nextBytes = Buffer.byteLength(part.text) + Buffer.byteLength(thought);
    if (!readers && bytes + nextBytes <= ASSEMBLY_BYTES && !options.windowed) {
      completeText += part.text;
      completeThinking += thought;
      bytes += nextBytes;
    } else {
      if (!readers) {
        readers = {
          body: makeReader("body"),
          thinking: makeReader("thinking"),
        };
        for (
          let at = 0;
          at < Math.max(completeText.length, completeThinking.length);
          at += 4999
        ) {
          readers.body.feed(completeText.slice(at, at + 4999));
          readers.thinking.feed(completeThinking.slice(at, at + 4999));
          if (at % (4999 * 8) === 0) {
            await setImmediate();
            if (!valid()) throw Error("BODY_SUPERSEDED");
          }
        }
        completeText = completeThinking = "";
      }
      readers.body.feed(part.text);
      readers.thinking.feed(thought);
    }
    indexes.body.length += part.text.length;
    indexes.thinking.length += thought.length;
    if (!part.next_cursor) break;
    frame = {
      cursor: part.next_cursor,
      frame: frame.frame + 1,
      body: frame.body + part.text.length,
      thinking: frame.thinking + thought.length,
    };
    part = await query(part.next_cursor);
  }
  if (!readers)
    return assemble(
      first,
      thinking,
      region(completeText),
      region(completeThinking),
      false,
    );
  for (const name of ["body", "thinking"] as const) {
    readers[name].finish();
    indexes[name].definitions = readers[name].parser.definitions.text;
    indexes[name].lastMathStart = readers[name].parser.lastMathStart;
    indexes[name].overflow = readers[name].parser.definitions.overflow;
  }
  if (!valid()) throw Error("BODY_SUPERSEDED");
  return assemble(
    first,
    thinking,
    resultWindow(readers.body.selected, indexes.body),
    resultWindow(readers.thinking.selected, indexes.thinking),
    true,
    indexes,
  );
}
function assemble(
  first: Message,
  mode: boolean,
  body: RegionWindow,
  thinking: RegionWindow,
  windowed: boolean,
  index?: Record<Region, RegionIndex>,
): MessageBody {
  return {
    mode,
    message: {
      ...first,
      text: body.text,
      ...(mode ? { thinking: thinking.text } : {}),
      next_cursor: null,
    },
    body,
    thinking,
    windowed,
    ...(index ? { index } : {}),
  };
}
/** Count source and retained definition contexts; metadata/checkpoints have fixed caps. */
export function bodyBytes(body: MessageBody) {
  return (["body", "thinking"] as const).reduce((sum, name) => {
    const window = body[name];
    const checkpoints = body.index?.[name].checkpoints ?? [];
    return (
      sum +
      Buffer.byteLength(window.text) +
      Buffer.byteLength(window.prefix) +
      Buffer.byteLength(window.suffix) +
      Buffer.byteLength(window.definitions) +
      checkpoints.reduce(
        (n, p) => n + Buffer.byteLength(p.context?.prefix ?? ""),
        0,
      )
    );
  }, 0);
}
