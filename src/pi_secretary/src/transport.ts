import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { PreviewUpdate } from "./preview.ts";
import type { StreamFn } from "./model.ts";
import type { Scope, ModelCall, Context } from "./contracts.ts";
import { Store, base, now, revise } from "./store.ts";
import { saveContext } from "./context.ts";
// Persist the whole provider response before Pi can execute a parsed tool call.
export function durableStream(
  store: Store,
  stream: StreamFn,
  scope: Scope,
  loopID: string,
  purpose: Context["purpose"],
  metadata: {
    consciousnessRevision?: number | null;
    maxTokens?: number;
    observe?: (update: PreviewUpdate) => void;
  } = {},
): StreamFn {
  let count = 0;
  return async (model, context, options) => {
    if (++count > 20) throw Error("MODEL_CALL_LIMIT");
    const input = saveContext(
      store,
      context.messages,
      scope,
      purpose,
      model.id,
      loopID,
      model.contextWindow,
      {
        consciousnessRevision: metadata.consciousnessRevision,
        captureKind: "MODEL_REQUEST",
      },
    );
    const call: ModelCall = {
      schema_version: 1,
      record_type: "ModelCall",
      ...base(input.call_id),
      state: "PREPARED",
      context_id: input.id,
      scope,
      transport_attempt: 1,
      request: store.put(context),
      response: null,
      started_at: null,
      completed_at: null,
      error: null,
    };
    store.commit([call]);
    const active = revise(call, { state: "IN_FLIGHT", started_at: now() });
    store.commit([active]);
    const observe = (update: PreviewUpdate) => {
      try {
        metadata.observe?.(update);
      } catch {
        /* Display cannot affect execution. */
      }
    };
    observe({
      type: "start",
      id: call.id,
      loop: loopID,
      session: scope.session_id ?? "",
    });
    const signal = AbortSignal.any([
      ...(options?.signal ? [options.signal] : []),
      AbortSignal.timeout(120000),
    ]);
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason ?? Error("MODEL_ABORTED"));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    void aborted.catch(() => {});
    try {
      signal.throwIfAborted();
      const response = await Promise.race([
        Promise.resolve(
          stream(model, context, {
            ...options,
            ...(metadata.maxTokens ? { maxTokens: metadata.maxTokens } : {}),
            sessionId: scope.execution_id ?? scope.session_id ?? loopID,
            signal,
          }),
        ),
        aborted,
      ]);
      // One consumer only: fan out to display and the delayed Agent stream.
      const replay = createAssistantMessageEventStream();
      if (metadata.observe) {
        const iterator = response[Symbol.asyncIterator]();
        while (true) {
          const next = await Promise.race([iterator.next(), aborted]);
          if (next.done) break;
          observe({ type: "event", id: call.id, event: next.value });
          replay.push(next.value);
        }
      }
      const complete = await Promise.race([response.result(), aborted]);
      store.commit(
        [
          revise(active, {
            state:
              complete.stopReason === "aborted"
                ? "INTERRUPTED"
                : complete.stopReason === "error"
                  ? "FAILED"
                  : "RESPONSE_SAVED",
            response: store.put(complete),
            completed_at: now(),
            error: complete.errorMessage ?? null,
          }),
        ],
        [store.event("model.response", complete, scope)],
      );
      observe({
        type:
          complete.stopReason === "aborted" || complete.stopReason === "error"
            ? "failed"
            : "saved",
        id: call.id,
      });
      if (metadata.observe) replay.end(complete);
      return metadata.observe ? replay : response;
    } catch (error) {
      observe({ type: "failed", id: call.id });
      const current = store.get<ModelCall>("ModelCall", active.id);
      if (current.state === "IN_FLIGHT")
        store.commit([
          revise(current, {
            state: "INTERRUPTED",
            error: String(error),
            completed_at: now(),
          }),
        ]);
      throw error;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  };
}
