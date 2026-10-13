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
  ) {}
  write(text: string) {
    text = this.pending + text;
    this.pending = /[\uD800-\uDBFF]$/.test(text) ? text.slice(-1) : "";
    if (this.pending) text = text.slice(0, -1);
    this.consume(text);
  }
  private consume(text: string) {
    this.digest.update(text);
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
) {
  if (
    ref.path !== "objects/" + ref.sha256 ||
    !/^[a-f0-9]{64}$/.test(ref.sha256) ||
    !Number.isSafeInteger(ref.bytes) ||
    ref.bytes < 0 ||
    fs.lstatSync(path.join(store.dir, "objects")).isSymbolicLink()
  )
    throw Error("CORRUPT_SOURCE");
  const fd = await fs.promises.open(
    path.join(store.dir, ref.path),
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    const stat = await fd.stat();
    if (!stat.isFile() || stat.size !== ref.bytes)
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
    if (depth !== 0 || digest.digest("hex") !== ref.sha256)
      throw Error("CORRUPT_SOURCE");
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
async function receiptMetadata(store: Store, ref: ObjectRef) {
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
  await scan(store, ref, (key) => {
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
  });
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
  constructor(
    readonly store: Store,
    readonly cursors: Cursors,
    readonly domain: string,
  ) {}
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
  private async original(op: Operation) {
    let ref = op.receipt;
    const seen = new Set<string>();
    while (ref) {
      if (seen.has(ref.sha256) || seen.size >= 8) throw Error("INVALID_SOURCE");
      seen.add(ref.sha256);
      const metadata = await receiptMetadata(this.store, ref);
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
    const sink = new WindowText(saved?.offset ?? 0, limit);
    let available = false;
    try {
      if (part === "parameters") {
        const allowed = parameterKeys[op.action.action];
        if (!allowed) return unavailable("UNSUPPORTED_ACTION");
        if (op.action.parameters_hash !== op.action.parameters_ref.sha256)
          throw Error("CORRUPT_SOURCE");
        sink.write("{");
        let count = 0;
        await scan(this.store, op.action.parameters_ref, (key) => {
          if (!allowed.includes(key)) return;
          if (count++) sink.write(",");
          sink.write(JSON.stringify(key) + ":");
          return jsonWriter(
            sink,
            op.action.action === "world.change" &&
              ["evidence", "provenance"].includes(key),
          );
        });
        sink.write("}");
        available = true;
      } else {
        const original = await this.original(op);
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
            await scan(this.store, original.ref, (key) => {
              if (key !== "error") return;
              sink.write(',"receipt_error":');
              return jsonWriter(sink);
            });
          if (op.receipt)
            await scan(this.store, op.receipt, (key) => {
              if (key !== "note") return;
              sink.write(',"resolution_note":');
              return jsonWriter(sink);
            });
          sink.write("}");
          available = true;
        } else if (original) {
          let isString = false,
            started = false;
          await scan(this.store, original.ref, (key) =>
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
    return {
      state: "available",
      text: value.text,
      bytes: value.bytes,
      content_version: value.content_version,
      truncated: value.truncated,
      unavailable_reason: null,
      next_cursor: value.truncated
        ? this.cursors.encode(scope, {
            offset: value.end,
            version: value.content_version,
          })
        : null,
    };
  }
  async view(op: Operation, divisor = 1) {
    const texts = {} as Record<OperationPart, DisplayText>;
    // Sequential scans keep the per-request working set bounded.
    for (const part of operationParts)
      texts[part] = await this.text(
        op,
        part,
        null,
        Math.floor(firstLimits[part] / divisor),
      );
    let source_truncated: boolean | null = null;
    try {
      const original = await this.original(op);
      if (original && typeof original.metadata.truncated === "boolean")
        source_truncated = original.metadata.truncated;
    } catch {
      /* Each affected text already carries its explicit unavailable reason. */
    }
    return { ...texts, source_truncated };
  }
}
