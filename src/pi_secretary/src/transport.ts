import {
  assertRequestBudget,
  assertFinalPayload,
  requestBudget,
  type RequestBudget,
} from "./budget.ts";
import { activitiesFor } from "./activity.ts";
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
    onPrepared?: (call: ModelCall) => void;
    maxTokens?: number;
    requestMetadata?: () => {
      sourceContextID?: string | null;
      compactionJobID?: string | null;
      consciousnessRevision?: number | null;
    };
    activityPhase?: "正在整理回复";
    observe?: (update: PreviewUpdate) => void;
  } = {},
): StreamFn {
  let count = 0;
  return async (model, context, options) => {
    if (++count > 20) throw Error("MODEL_CALL_LIMIT");
    const requestMetadata = metadata.requestMetadata?.();
    const budgetOptions = {
      role: purpose === "TASK" ? ("task" as const) : ("main" as const),
      maxTokens: metadata.maxTokens ?? options?.maxTokens,
    };
    let budget: RequestBudget;
    try {
      budget = assertRequestBudget(model, context.messages, budgetOptions);
    } catch (error) {
      let diagnostic: RequestBudget | undefined;
      try {
        diagnostic = requestBudget(model, context.messages, budgetOptions);
      } catch {
        /* Invalid metadata or uncountable payload has no numeric budget. */
      }
      store.commit(
        [],
        [
          store.event(
            "model.capacity_blocked",
            {
              loop_id: loopID,
              purpose,
              model: model.id,
              provider: model.provider,
              api: model.api,
              request_ref: store.put(context),
              request_budget: diagnostic ?? null,
              source_context_id: requestMetadata?.sourceContextID ?? null,
              error: String(error),
              sent: false,
            },
            scope,
          ),
        ],
      );
      throw error;
    }
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
        budget,
        ...requestMetadata,
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
    // Extraction links the exact prepared call durably before any send is possible.
    metadata.onPrepared?.(call);
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
    const activity = activitiesFor(store);
    const activityID = "model:" + call.id;
    const parent =
      purpose === "TASK"
        ? "task:" + scope.execution_id
        : purpose === "COMPACTION"
          ? (store.find("SettingsApplication", loopID)
              ? "settings:"
              : "compaction:") + loopID
          : null;
    try {
      activity.start(
        activityID,
        scope,
        purpose === "COMPACTION" ? "compaction" : "model",
        purpose === "COMPACTION"
          ? "正在整理记忆"
          : (metadata.activityPhase ?? "正在思考"),
        parent,
        { loop_id: loopID, call_id: call.id },
      );
    } catch {}
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
            maxTokens: budget.effective_output_tokens,
            onPayload: async (payload, actualModel) => {
              const changed = await options?.onPayload?.(payload, actualModel);
              const final = changed === undefined ? payload : changed;
              const facts = assertFinalPayload(actualModel, final, budget);
              store.commit(
                [],
                [
                  store.event(
                    "model.payload",
                    {
                      call_id: call.id,
                      context_id: input.id,
                      payload_ref: store.put(final),
                      count_method: budget.count_method,
                      ...facts,
                    },
                    scope,
                  ),
                ],
              );
              return final;
            },
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
      try {
        activity.end(
          activityID,
          complete.stopReason === "aborted"
            ? "interrupted"
            : complete.stopReason === "error"
              ? "failed"
              : "succeeded",
          complete.errorMessage,
        );
      } catch {}
      if (metadata.observe) replay.end(complete);
      return metadata.observe ? replay : response;
    } catch (error) {
      try {
        activity.end(activityID, "interrupted", error);
      } catch {}
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
