import { setTimeout as delay } from "node:timers/promises";
import type { Store } from "./store.ts";

// Per-Store clock injection keeps deterministic tests out of production configuration.
export const retryRuntime = new WeakMap<
  Store,
  {
    now?: () => number;
    wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
    timeoutMs?: number;
  }
>();
export const retryNow = (store: Store) =>
  retryRuntime.get(store)?.now?.() ?? Date.now();
export async function retryWait(
  store: Store,
  ms: number,
  signal?: AbortSignal,
) {
  const wait = retryRuntime.get(store)?.wait;
  if (wait) return wait(ms, signal);
  // Node timers overflow above 2^31-1 ms; never shorten a long Retry-After to 1 ms.
  while (ms > 0) {
    const chunk = Math.min(ms, 2_147_483_647);
    await delay(chunk, undefined, { signal });
    ms -= chunk;
  }
  signal?.throwIfAborted();
}
export function retryAfter(
  value: string | null | undefined,
  now: number,
): number {
  if (!value) return 0;
  const seconds = /^\d+(\.\d+)?$/.test(value.trim())
    ? Number(value) * 1000
    : Date.parse(value) - now;
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
}
export function transportFailure(
  error: unknown,
  status?: number,
  cancelled = false,
) {
  const text = String(error);
  if (cancelled) return "CANCELLED" as const;
  if (/CAPACITY_|BUDGET_|PAYLOAD_|MODEL_CALL_LIMIT/.test(text))
    return "LOCAL" as const;
  const sdkStatus =
    error && typeof error === "object" && "status" in error
      ? error.status
      : undefined;
  const code =
    [status, sdkStatus].find(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    ) ??
    Number(text.match(/(?:HTTP\s*|status[=: ]+|^Error:\s*)([45]\d\d)\b/i)?.[1]);
  if ([408, 409, 429].includes(code) || (code >= 500 && code <= 599))
    return "TRANSIENT" as const;
  if (code >= 400 && code <= 499) return "PERMANENT" as const;
  if (
    /overloaded_error|overloaded|rate.limit|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|fetch failed|network_error|network error|connection error|socket hang up|TimeoutError|timed out/i.test(
      text,
    )
  )
    return "TRANSIENT" as const;
  if (
    /authentication|invalid.api.key|unauthorized|invalid.request|bad.request/i.test(
      text,
    )
  )
    return "PERMANENT" as const;
  return "LOCAL" as const;
}
// Initial maintenance plus three retries. Failure number is zero-based.
export function maintenanceRetryAt(
  store: Store,
  round: number,
  error: unknown,
): string | null {
  const text = String(error);
  if (
    /CAPACITY_|BUDGET_|INVALID_SETTINGS_EXTRACTION_EVIDENCE|IDENTITY_AMBIGUOUS|SOURCE_MISSING|MODEL_TRANSPORT_(PERMANENT|CANCELLED|LOCAL)/.test(
      text,
    )
  )
    return null;
  const ms = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000][round];
  return ms === undefined ? null : new Date(retryNow(store) + ms).toISOString();
}

const lifetimes = new WeakMap<Store, AbortController>();
export function modelLifetime(store: Store) {
  let controller = lifetimes.get(store);
  if (!controller) lifetimes.set(store, (controller = new AbortController()));
  return controller;
}
