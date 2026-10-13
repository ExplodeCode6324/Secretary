import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import parser, { type Token } from "stream-json/parser.js";
import stringer from "stream-json/core/stringer.js";
import type { ObjectRef, Operation } from "./contracts.ts";
import type { Store } from "./store.ts";
import { ApiError, Cursors } from "./api/protocol.ts";
import {
  OperationTextCache,
  TextCapture,
  sourceStamp,
  statStamp,
  type SourceStamp,
} from "./operation-text-cache.ts";

export const operationParts = [
  "parameters",
  "stdout",
  "stderr",
  "reason",
] as const;
export type OperationPart = (typeof operationParts)[number];
export type DisplayText = {
  state: "available" | "unavailable";
  text: string;
  bytes: string;
  content_version: string | null;
  truncated: boolean;
  next_cursor: string | null;
  unavailable_reason: string | null;
};
const firstLimits = {
  parameters: 16384,
  stdout: 32768,
  stderr: 32768,
  reason: 4096,
};
const unavailable = (reason: string): DisplayText => ({
  state: "unavailable",
  text: "",
  bytes: "0",
  content_version: null,
  truncated: false,
  next_cursor: null,
  unavailable_reason: reason,
});

/** Hash all public text, retain only one UTF-8 window. No whole-value buffering. */
class WindowText {
  bytes = 0;
  text = "";
  private pending = "";
  private digest = createHash("sha256");
  private used = 0;
  private closedWindow = false;
  constructor(
    readonly offset = 0,
    readonly limit = 32768,
    readonly capture?: TextCapture,
  ) {}
  write(text: string) {
    text = this.pending + text;
    this.pending = /[\uD800-\uDBFF]$/.test(text) ? text.slice(-1) : "";
    if (this.pending) text = text.slice(0, -1);
    this.consume(text);
  }
  private consume(text: string) {
    this.digest.update(text);
    this.capture?.write(text);
    for (const character of text) {
      const bytes = Buffer.byteLength(character);
      if (this.bytes >= this.offset && !this.closedWindow) {
        if (this.used + bytes <= this.limit) {
          this.text += character;
          this.used += bytes;
        } else this.closedWindow = true;
      }
      this.bytes += bytes;
    }
  }
  finish() {
    if (this.pending) this.consume(this.pending);
    this.pending = "";
    return {
      text: this.text,
      bytes: String(this.bytes),
      content_version: this.digest.digest("hex"),
      truncated: this.offset + this.used < this.bytes,
      end: this.offset + this.used,
    };
  }
}

type Handler = (token: Token) => void;
/** Root fields are selected before any value is assembled. Keys/depth are bounded. */
async function scan(
  store: Store,
  ref: ObjectRef,
  field: (key: string) => Handler | undefined,
  sources?: SourceStamp[],
) {
  sourceStamp(store, ref);
  const fd = await fs.promises.open(
    path.join(store.dir, ref.path),
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    const stat = await fd.stat({ bigint: true });
    if (!stat.isFile() || stat.size !== BigInt(ref.bytes))
      throw Error("CORRUPT_SOURCE");
    const digest = createHash("sha256");
    let depth = 0,
      inKey = false,
      key = "",
      root = false;
    let handler: Handler | undefined;
    const selected = new Set<string>();
    await pipeline(
      fd.createReadStream({ autoClose: false, highWaterMark: 16384 }),
      new Transform({
        transform(chunk, _encoding, done) {
          digest.update(chunk);
          done(null, chunk);
        },
      }),
      parser.asStream({ packValues: false }),
      new Writable({
        objectMode: true,
        write(token: Token, _encoding, done) {
          try {
            if (!root) {
              if (token.name !== "startObject") throw Error("INVALID_SOURCE");
              root = true;
              depth = 1;
              done();
              return;
            }
            if (depth === 1 && token.name === "startKey") {
              inKey = true;
              key = "";
              handler = undefined;
            } else if (inKey) {
              if (token.name === "stringChunk") {
                if (key.length < 256) key = (key + token.value).slice(0, 256);
              } else if (token.name === "endKey") {
                inKey = false;
                handler = field(key);
                if (handler) {
                  if (selected.has(key)) throw Error("INVALID_SOURCE");
                  selected.add(key);
                }
              }
            } else if (!(depth === 1 && token.name === "endObject"))
              handler?.(token);
            if (token.name === "startObject" || token.name === "startArray")
              depth++;
            if (token.name === "endObject" || token.name === "endArray")
              depth--;
            if (depth > 64) throw Error("SOURCE_TOO_DEEP");
            done();
          } catch (error) {
            done(error as Error);
          }
        },
      }),
    );
    if (
      depth !== 0 ||
      digest.digest("hex") !== ref.sha256 ||
      statStamp(stat) !== statStamp(await fd.stat({ bigint: true }))
    )
      throw Error("CORRUPT_SOURCE");
    sources?.push({ ref: { ...ref }, stamp: statStamp(stat) });
  } finally {
    await fd.close();
  }
}

function jsonWriter(sink: WindowText, omitReferencePaths = false): Handler {
  const serialize = stringer({ useKeyValues: true });
  let key: string | null = null,
    depth = 0,
    skipAt: number | null = null;
  const emit = (token: Token) => {
    const value = serialize(token);
    if (typeof value === "string") sink.write(value);
  };
  return (token) => {
    if (token.name === "startKey") {
      key = "";
      return;
    }
    if (key !== null) {
      if (token.name === "stringChunk") {
        key += token.value;
        if (key.length > 8192) throw Error("SOURCE_KEY_TOO_LONG");
      } else if (token.name === "endKey") {
        if (skipAt === null && omitReferencePaths && key === "path")
          skipAt = depth;
        else if (skipAt === null) emit({ name: "keyValue", value: key });
        key = null;
      }
      return;
    }
    if (skipAt === null) emit(token);
    if (token.name === "startObject" || token.name === "startArray") depth++;
    if (token.name === "endObject" || token.name === "endArray") depth--;
    if (
      skipAt === depth &&
      [
        "endString",
        "endNumber",
        "endObject",
        "endArray",
        "nullValue",
        "trueValue",
        "falseValue",
      ].includes(token.name)
    )
      skipAt = null;
  };
}

const parameterKeys: Record<string, readonly string[]> = {
  "shell.run": ["command", "cwd", "timeout"],
  "file.write": ["path", "content"],
  "program.run": [
    "program_id",
    "revision",
    "code_digest",
    "capability",
    "parameters",
  ],
  "world.change": [
    "record_type",
    "request_id",
    "change_id",
    "request_hash",
    "source_id",
    "subject_id",
    "predicate_key",
    "scope_key",
    "expected_revision",
    "mode",
    "value",
    "object_entity_id",
    "assertion_id",
    "replaces_assertion_id",
    "resolve_conflict_id",
    "resolution_note",
    "provenance",
    "valid_from",
    "valid_to",
    "fresh_until",
    "kind",
    "entity_id",
    "entity_kind",
    "display_name",
    "external_key",
    "source_kind",
    "source_key",
    "description",
    "evidence",
    "aliases",
  ],
};

function sourceError(error: unknown) {
  if ((error as NodeJS.ErrnoException)?.code === "ENOENT")
    return "SOURCE_MISSING";
  const message = error instanceof Error ? error.message : "";
  return ["SOURCE_TOO_DEEP", "SOURCE_KEY_TOO_LONG", "INVALID_SOURCE"].includes(
    message,
  )
    ? message
    : "CORRUPT_SOURCE";
}

/** Read a small metadata field, never build the surrounding stdout or parameters. */
async function receiptMetadata(
  store: Store,
  ref: ObjectRef,
  sources?: SourceStamp[],
) {
  const values: Record<string, WindowText> = {};
  const strings: Record<string, WindowText> = {};
  const keys = new Set([
    "resolved_by",
    "outcome",
    "note",
    "resolved_at",
    "original_receipt",
    "timed_out",
    "truncated",
    "signal",
    "exit_code",
    "code",
    "not_started",
    "error",
  ]);
  await scan(
    store,
    ref,
    (key) => {
      if (!keys.has(key)) return;
      const sink = (values[key] = new WindowText(
        0,
        key === "note" || key === "error" ? 8192 : 4096,
      ));
      const json = jsonWriter(sink);
      let first = true,
        plain: WindowText | undefined;
      return (token) => {
        if (first) {
          first = false;
          if (["note", "error"].includes(key) && token.name === "startString")
            plain = strings[key] = new WindowText(0, 4096);
        } else if (plain && token.name === "stringChunk")
          plain.write(token.value);
        json(token);
      };
    },
    sources,
  );
  const result: Record<string, unknown> = {};
  for (const [key, sink] of Object.entries(values)) {
    const value = sink.finish();
    if (value.truncated) {
      if (key === "note" || key === "error") {
        result[key] = strings[key]?.finish().text ?? null;
        result[key + "_truncated"] = true;
      } else throw Error("INVALID_SOURCE");
    } else result[key] = JSON.parse(value.text);
  }
  return result;
}

export class OperationDisplay {
  private readonly cache: OperationTextCache;
  constructor(
    readonly store: Store,
    readonly cursors: Cursors,
    readonly domain: string,
  ) {
    this.cache = new OperationTextCache(store);
  }
  async resolution(op: Operation, strict = false) {
    if (!op.receipt) return null;
    try {
      const r = await receiptMetadata(this.store, op.receipt);
      return r.resolved_by === "MASTER_UI"
        ? {
            outcome: r.outcome,
            resolved_by: r.resolved_by,
            note: r.note,
            resolved_at: r.resolved_at,
            note_truncated: r.note_truncated === true,
          }
        : null;
    } catch (error) {
      if (strict) throw new ApiError(sourceError(error), 503);
      return null;
    }
  }
  private async original(op: Operation, sources: SourceStamp[]) {
    let ref = op.receipt;
    const seen = new Set<string>();
    while (ref) {
      if (seen.has(ref.sha256) || seen.size >= 8) throw Error("INVALID_SOURCE");
      seen.add(ref.sha256);
      const metadata = await receiptMetadata(this.store, ref, sources);
      if (metadata.resolved_by !== "MASTER_UI") return { ref, metadata };
      ref = metadata.original_receipt as ObjectRef | null;
      if (ref === undefined) throw Error("INVALID_SOURCE");
    }
    return null;
  }
  async text(
    op: Operation,
    part: OperationPart,
    cursor?: string | null,
    limit = firstLimits[part],
    context?: {
      value: Awaited<ReturnType<OperationDisplay["original"]>>;
      sources: SourceStamp[];
      error?: unknown;
    },
  ): Promise<DisplayText> {
    const scope = `operation:${this.domain}:${op.id}:${part}`;
    const saved = cursor
      ? this.cursors.decode<{ offset: number; version: string }>(scope, cursor)
      : null;
    if (
      saved &&
      (!Number.isSafeInteger(saved.offset) ||
        saved.offset < 0 ||
        typeof saved.version !== "string")
    )
      throw new ApiError("CURSOR_EXPIRED", 409);
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          op.id,
          op.revision,
          op.action,
          op.receipt,
          op.state,
          op.effect,
          op.error,
          part,
        ]),
      )
      .digest("hex");
    const cached = this.cache.get(key);
    if (cached) {
      if (
        saved &&
        (saved.version !== cached.version ||
          saved.offset > cached.content.length)
      )
        throw new ApiError("CURSOR_EXPIRED", 409);
      const offset = saved?.offset ?? 0;
      let end = Math.min(cached.content.length, offset + limit);
      while (
        end > offset &&
        end < cached.content.length &&
        (cached.content[end] & 0xc0) === 0x80
      )
        end--;
      return this.page(
        scope,
        cached.content.subarray(offset, end).toString("utf8"),
        String(cached.content.length),
        cached.version,
        end,
      );
    }
    const sources: SourceStamp[] = [];
    const capture = new TextCapture(OperationTextCache.captureLimit);
    const sink = new WindowText(saved?.offset ?? 0, limit, capture);
    let available = false;
    try {
      if (part === "parameters") {
        const allowed = parameterKeys[op.action.action];
        if (!allowed) return unavailable("UNSUPPORTED_ACTION");
        if (op.action.parameters_hash !== op.action.parameters_ref.sha256)
          throw Error("CORRUPT_SOURCE");
        sink.write("{");
        let count = 0;
        await scan(
          this.store,
          op.action.parameters_ref,
          (key) => {
            if (!allowed.includes(key)) return;
            if (count++) sink.write(",");
            sink.write(JSON.stringify(key) + ":");
            return jsonWriter(
              sink,
              op.action.action === "world.change" &&
                ["evidence", "provenance"].includes(key),
            );
          },
          sources,
        );
        sink.write("}");
        available = true;
      } else {
        if (context?.error) throw context.error;
        if (context) sources.push(...context.sources);
        const original = context
          ? context.value
          : await this.original(op, sources);
        if (part === "reason") {
          const evidence = original?.metadata ?? {};
          const base = JSON.stringify({
            state: op.state,
            effect: op.effect,
            error: op.error,
            ...Object.fromEntries(
              [
                "timed_out",
                "truncated",
                "signal",
                "exit_code",
                "code",
                "not_started",
              ]
                .filter((k) => k in evidence)
                .map((k) => [k, evidence[k]]),
            ),
            receipt_available: original !== null,
          });
          sink.write(base.slice(0, -1));
          if (original)
            await scan(
              this.store,
              original.ref,
              (key) => {
                if (key !== "error") return;
                sink.write(',"receipt_error":');
                return jsonWriter(sink);
              },
              sources,
            );
          if (op.receipt)
            await scan(
              this.store,
              op.receipt,
              (key) => {
                if (key !== "note") return;
                sink.write(',"resolution_note":');
                return jsonWriter(sink);
              },
              sources,
            );
          sink.write("}");
          available = true;
        } else if (original) {
          let isString = false,
            started = false;
          await scan(
            this.store,
            original.ref,
            (key) =>
              key === part
                ? (token) => {
                    if (!started) {
                      started = true;
                      isString = token.name === "startString";
                      available = isString;
                    } else if (token.name === "stringChunk" && isString)
                      sink.write(token.value);
                    else if (token.name === "endString") isString = false;
                  }
                : undefined,
            sources,
          );
        }
      }
    } catch (error) {
      return unavailable(sourceError(error));
    }
    if (!available) return unavailable("NOT_RECORDED");
    const value = sink.finish();
    if (
      saved &&
      (saved.version !== value.content_version ||
        saved.offset > Number(value.bytes))
    )
      throw new ApiError("CURSOR_EXPIRED", 409);
    const content = capture.finish();
    if (content)
      this.cache.put(key, { content, version: value.content_version, sources });
    return this.page(
      scope,
      value.text,
      value.bytes,
      value.content_version,
      value.end,
    );
  }
  private page(
    scope: string,
    text: string,
    bytes: string,
    version: string,
    end: number,
  ): DisplayText {
    const truncated = end < Number(bytes);
    return {
      state: "available",
      text,
      bytes,
      content_version: version,
      truncated,
      unavailable_reason: null,
      next_cursor: truncated
        ? this.cursors.encode(scope, { offset: end, version })
        : null,
    };
  }
  shrink(
    op: Operation,
    view: Awaited<ReturnType<OperationDisplay["view"]>>,
    divisor: number,
  ) {
    const result = { ...view };
    for (const part of operationParts) {
      const original = view[part];
      if (original.state !== "available") continue;
      const sink = new WindowText(0, Math.floor(firstLimits[part] / divisor));
      sink.write(original.text);
      const prefix = sink.finish();
      result[part] = this.page(
        `operation:${this.domain}:${op.id}:${part}`,
        prefix.text,
        original.bytes,
        original.content_version!,
        prefix.end,
      );
    }
    return result;
  }
  async view(op: Operation) {
    const sources: SourceStamp[] = [];
    let original: Awaited<ReturnType<OperationDisplay["original"]>> = null;
    let error: unknown;
    try {
      original = await this.original(op, sources);
    } catch (failure) {
      error = failure;
    }
    const texts = {} as Record<OperationPart, DisplayText>;
    for (const part of operationParts)
      texts[part] = await this.text(op, part, null, firstLimits[part], {
        value: original,
        sources,
        error,
      });
    return {
      ...texts,
      source_truncated:
        typeof original?.metadata.truncated === "boolean"
          ? original.metadata.truncated
          : null,
    };
  }
}
