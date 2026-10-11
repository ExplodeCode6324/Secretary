import {
  assertRequestBudget,
  assertFinalPayload,
  requestBudget,
  type RequestBudget,
} from "./budget.ts";
import { activitiesFor } from "./activity.ts";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import type { PreviewUpdate } from "./preview.ts";
import type { StreamFn } from "./model.ts";
import type { Scope, ModelCall, Context } from "./contracts.ts";
import { Store, base, now, revise, hash } from "./store.ts";
import { saveContext } from "./context.ts";
import {
  retryNow,
  retryWait,
  retryAfter,
  retryRuntime,
  transportFailure,
  modelLifetime,
} from "./model-retry.ts";

function savedResponse(message: AssistantMessage) {
  const replay = createAssistantMessageEventStream();
  replay.push({
    type: "done",
    reason: message.stopReason as "stop" | "length" | "toolUse",
    message,
  });
  replay.end(message);
  return replay;
}
// No stream, including one containing tool calls, reaches Agent before durable success.
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
    requestKey?: string;
    generation?: number;
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
    options = {
      ...options,
      signal: AbortSignal.any([
        modelLifetime(store).signal,
        ...(options?.signal ? [options.signal] : []),
      ]),
    };
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
      } catch {}
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
    // Agent-created prompt timestamps change on recovery; content and position do not.
    const key = hash(
      JSON.stringify({
        scope,
        loopID,
        purpose,
        generation: metadata.generation ?? 0,
        model: [model.provider, model.api, model.id, model.baseUrl],
        identity: metadata.requestKey ?? {
          ...context,
          messages: context.messages.map(({ timestamp, ...m }) => m),
        },
        maxTokens: budget.effective_output_tokens,
      }),
    );
    const prior = store
      .all<ModelCall>("ModelCall")
      .filter((c) => c.logical_key === key);
    let last = prior.at(-1);
    const observe = (update: PreviewUpdate) => {
      try {
        metadata.observe?.(update);
      } catch {}
    };
    if (last?.state === "RESPONSE_SAVED" && last.response) {
      metadata.onPrepared?.(last);
      observe({
        type: "start",
        id: last.id,
        loop: loopID,
        session: scope.session_id ?? "",
      });
      observe({ type: "saved", id: last.id });
      return savedResponse(store.read<AssistantMessage>(last.response));
    }
    // Frozen request bytes also retain the original existing-ledger snapshot on replay.
    if (last) context = store.read<Parameters<StreamFn>[1]>(last.request);
    if (last?.state === "IN_FLIGHT") {
      last = revise(last, {
        state: "INTERRUPTED",
        failure_kind: "TRANSIENT",
        error: "PROCESS_INTERRUPTED",
        completed_at: now(),
        retry_at: new Date(
          retryNow(store) + (last.transport_attempt === 1 ? 2000 : 10000),
        ).toISOString(),
      });
      store.commit([last]);
    }
    const failure = (call: ModelCall) =>
      Error(
        `MODEL_TRANSPORT_${call.failure_kind ?? "LOCAL"}:${call.id}: ${call.error ?? "failed"}`,
      );
    if (
      last &&
      last.state !== "PREPARED" &&
      (last.transport_attempt >= 3 || last.failure_kind !== "TRANSIENT")
    )
      throw failure(last);
    for (
      let attempt =
        last?.state === "PREPARED"
          ? last.transport_attempt
          : (last?.transport_attempt ?? 0) + 1;
      attempt <= 3;
      attempt++
    ) {
      options?.signal?.throwIfAborted();
      if (last?.retry_at)
        await retryWait(
          store,
          Math.max(0, Date.parse(last.retry_at) - retryNow(store)),
          options?.signal,
        );
      options?.signal?.throwIfAborted();
      const input =
        last?.state === "PREPARED"
          ? store.get<Context>("Context", last.context_id)
          : saveContext(
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
      const call: ModelCall =
        last?.state === "PREPARED"
          ? last
          : {
              schema_version: 1,
              record_type: "ModelCall",
              ...base(input.call_id),
              state: "PREPARED",
              context_id: input.id,
              scope,
              transport_attempt: attempt,
              logical_key: key,
              request: store.put(context),
              response: null,
              started_at: null,
              completed_at: null,
              error: null,
            };
      if (last?.state !== "PREPARED") store.commit([call]);
      metadata.onPrepared?.(call);
      const active = revise(call, { state: "IN_FLIGHT", started_at: now() });
      store.commit([active]);
      observe({
        type: "start",
        id: call.id,
        loop: loopID,
        session: scope.session_id ?? "",
      });
      const activity = activitiesFor(store),
        activityID = "model:" + call.id;
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
      const timeout = AbortSignal.timeout(
        retryRuntime.get(store)?.timeoutMs ?? 120000,
      );
      const signal = AbortSignal.any([
        ...(options?.signal ? [options.signal] : []),
        timeout,
      ]);
      let onAbort: () => void = () => {};
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason ?? Error("MODEL_ABORTED"));
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      });
      void aborted.catch(() => {});
      let status: number | undefined,
        after: string | null = null,
        networkError: unknown;
      let complete: AssistantMessage | undefined;
      try {
        signal.throwIfAborted();
        const response = await Promise.race([
          Promise.resolve(
            stream(model, context, {
              ...options,
              signal,
              maxRetries: 0,
              maxTokens: budget.effective_output_tokens,
              // SDK onResponse runs only after withResponse succeeds; fetch captures error headers too.
              fetch: async (url, init) => {
                try {
                  const response = await (options?.fetch ?? globalThis.fetch)(
                    url,
                    init,
                  );
                  status = response.status;
                  after = response.headers.get("retry-after");
                  return response;
                } catch (error) {
                  networkError = error;
                  throw error;
                }
              },
              onResponse: async (response, actualModel) => {
                status = response.status;
                after = response.headers["retry-after"] ?? after;
                await options?.onResponse?.(response, actualModel);
              },
              onPayload: async (payload, actualModel) => {
                const changed = await options?.onPayload?.(
                  payload,
                  actualModel,
                );
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
            }),
          ),
          aborted,
        ]);
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
        complete = await Promise.race([response.result(), aborted]);
        if (["aborted", "error"].includes(complete.stopReason))
          throw Error(complete.errorMessage ?? "MODEL_ABORTED");
        store.commit(
          [
            revise(active, {
              state: "RESPONSE_SAVED",
              response: store.put(complete),
              completed_at: now(),
              error: null,
            }),
          ],
          [store.event("model.response", complete, scope)],
        );
        observe({ type: "saved", id: call.id });
        try {
          activity.end(activityID, "succeeded");
        } catch {}
        if (metadata.observe) {
          replay.end(complete);
          return replay;
        }
        return response;
      } catch (error) {
        const current = store.get<ModelCall>("ModelCall", call.id);
        if (current.state === "RESPONSE_SAVED") throw error; // Storage/observer failures must never resend saved success.
        const kind = transportFailure(
          timeout.aborted ? timeout.reason : (networkError ?? error),
          status,
          options?.signal?.aborted,
        );
        last = revise(current, {
          state: complete?.stopReason === "error" ? "FAILED" : "INTERRUPTED",
          response: complete ? store.put(complete) : null,
          error: String(error),
          completed_at: now(),
          failure_kind: kind,
          retry_at:
            kind === "TRANSIENT" && attempt < 3
              ? new Date(
                  retryNow(store) +
                    Math.max(
                      attempt === 1 ? 2000 : 10000,
                      retryAfter(after, retryNow(store)),
                    ),
                ).toISOString()
              : null,
        });
        store.commit(
          [last],
          complete ? [store.event("model.response", complete, scope)] : [],
        );
        observe({ type: "failed", id: call.id });
        try {
          activity.end(
            activityID,
            kind === "CANCELLED" ? "interrupted" : "failed",
            error,
          );
        } catch {}
        if (kind !== "TRANSIENT" || attempt === 3) {
          if (
            complete &&
            ["error", "aborted"].includes(complete.stopReason) &&
            metadata.observe &&
            kind !== "CANCELLED"
          ) {
            const diagnostic = {
              ...complete,
              errorMessage: failure(last).message,
            };
            const failed = createAssistantMessageEventStream();
            failed.push({
              type: "error",
              reason: diagnostic.stopReason as "error" | "aborted",
              error: diagnostic,
            });
            failed.end(diagnostic);
            return failed;
          }
          throw failure(last);
        }
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    }
    throw Error("MODEL_ATTEMPTS_EXHAUSTED");
  };
}
