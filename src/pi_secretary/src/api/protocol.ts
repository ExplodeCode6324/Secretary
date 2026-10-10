import fs from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { hash } from "../store.ts";
const schema = JSON.parse(
  fs.readFileSync(
    new URL("../../../../docs/api/v1/schema.json", import.meta.url),
    "utf8",
  ),
);
const ajv = new Ajv2020({ strict: false });
(addFormats as unknown as (a: Ajv2020) => void)(ajv);
ajv.addSchema(schema);
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
    readonly details?: { reason: string; recovery: string },
  ) {
    super(code);
  }
}
export function validate(
  name: string,
  value: unknown,
): asserts value is Record<string, unknown> {
  const check = ajv.getSchema("urn:secretary:api:v1#/$defs/" + name);
  if (!check?.(value)) throw new ApiError("INVALID_REQUEST");
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function revision(value: unknown, allowZero = false): number {
  if (
    typeof value !== "string" ||
    !(allowZero ? /^(0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/).test(value) ||
    !Number.isSafeInteger(Number(value))
  )
    throw new ApiError("INVALID_REVISION");
  return Number(value);
}
export function limitOf(query: URLSearchParams) {
  const text = query.get("limit") ?? "30";
  if (!/^[1-9][0-9]*$/.test(text) || Number(text) > 100)
    throw new ApiError("INVALID_LIMIT");
  return Number(text);
}
// Public read models never disclose CAS paths, model requests, or credentials.
export function project(value: unknown, key = ""): any {
  if (value === null || value === undefined) return value ?? null;
  // These are user/domain JSON values, not Store metadata. Never rename,
  // redact, or convert an arbitrary value's keys (including "revision" or
  // "entrypoint"); approval must show the exact action parameters.
  // value_schema is predicate-owned JSON Schema, not a CAS schema reference
  // such as ProgramRegistration.parameters_schema/result_schema.
  if (["parameters", "value", "answer", "value_schema"].includes(key))
    return structuredClone(value);
  // PostgreSQL timestamptz values arrive as Date objects, unlike journal dates.
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "number" &&
    /(?:revision|sequence|journal_seq|bytes|version)$/.test(key)
  ) {
    if (!Number.isSafeInteger(value)) throw new ApiError("UNSAFE_INTEGER", 500);
    return String(value);
  }
  if (Array.isArray(value)) return value.map((v) => project(v));
  if (typeof value !== "object") return value;
  const v = value as Record<string, unknown>;
  if ("sha256" in v && "media_type" in v && "path" in v)
    return {
      content_version: v.sha256,
      bytes: String(v.bytes),
      media_type: v.media_type,
    };
  return Object.fromEntries(
    Object.entries(v)
      .filter(
        ([k]) =>
          ![
            "record_type",
            "schema_version",
            "workspace",
            "entrypoint",
            "confirmation_ref",
            "parameters_ref",
            "parameter_constraints",
            "payload_ref",
            "candidate_ref",
            "source_ref",
            "binding_ref",
            "request_snapshot",
            "memory_source_ref",
          ].includes(k),
      )
      .map(([k, v]) => [k, project(v, k)]),
  );
}
export class Cursors {
  constructor(private secret: string) {}
  encode(scope: string, value: unknown) {
    const data = Buffer.from(
      JSON.stringify({ v: "api-v1", scope, value }),
    ).toString("base64url");
    return (
      data +
      "." +
      createHmac("sha256", this.secret).update(data).digest("base64url")
    );
  }
  decode<T>(scope: string, cursor: string): T {
    try {
      if (cursor.length > 8192) throw Error();
      const [data, signature, ...extra] = cursor.split(".");
      const expected = createHmac("sha256", this.secret).update(data).digest();
      const supplied = Buffer.from(signature, "base64url");
      if (
        extra.length ||
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      )
        throw Error();
      const parsed = JSON.parse(Buffer.from(data, "base64url").toString());
      if (parsed.v !== "api-v1" || parsed.scope !== scope) throw Error();
      return parsed.value as T;
    } catch {
      throw new ApiError("CURSOR_EXPIRED", 409);
    }
  }
  page<T>(scope: string, values: T[], query: URLSearchParams, version: string) {
    const cursor = query.get("cursor");
    const saved = cursor
      ? this.decode<{ version: string; offset: number }>(scope, cursor)
      : { version, offset: 0 };
    if (saved.version !== version) throw new ApiError("CURSOR_EXPIRED", 409);
    const limit = limitOf(query),
      items = values.slice(saved.offset, saved.offset + limit),
      end = saved.offset + items.length;
    return {
      items,
      version,
      next_cursor:
        end < values.length
          ? this.encode(scope, { version, offset: end })
          : null,
    };
  }
}
export function errorOf(error: unknown) {
  if (error instanceof ApiError) return error;
  const raw = error instanceof Error ? error.message : String(error);
  const code = /^[A-Z][A-Z0-9_]+/.exec(raw)?.[0] ?? "INTERNAL_ERROR";
  const status = /NOT_FOUND$/.test(code)
    ? 404
    : /CONFLICT|STALE|EXPIRED|RESET_REQUIRED|NOT_OPEN|INVALID_TRANSITION/.test(
          code,
        )
      ? 409
      : /UNAVAILABLE|BUSY|BLOCKED|IN_PROGRESS/.test(code)
        ? 503
        : /INVALID|EMPTY|REQUIRED|ONLY_|DRAFT_|MASTER_/.test(code)
          ? 400
          : 500;
  return new ApiError(code, status);
}
export const fingerprint = (value: unknown) => hash(canonical(value));
