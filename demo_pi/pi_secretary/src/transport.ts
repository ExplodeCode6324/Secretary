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
    try {
      const response = await stream(model, context, {
        ...options,
        sessionId: scope.execution_id ?? scope.session_id ?? loopID,
        signal: AbortSignal.any([
          ...(options?.signal ? [options.signal] : []),
          AbortSignal.timeout(120000),
        ]),
      });
      const complete = await response.result();
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
      return response;
    } catch (error) {
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
    }
  };
}
