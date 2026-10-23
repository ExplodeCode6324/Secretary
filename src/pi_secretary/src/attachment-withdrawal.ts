import type { Host } from "./host.ts";
import type { Input, Context, ModelCall, Operation } from "./contracts.ts";
import type { AgentMessage } from "./model.ts";
import { buildContext } from "./context.ts";
import {
  attachmentMessage,
  attachmentOwner,
  attachmentTag,
} from "./attachment-form.ts";
import { ApiError } from "./api/protocol.ts";
import { revise, now, type Stored } from "./store.ts";
/** Transport/Agent failure diagnostics carry no generated output. Preserve them
 * in audit records while allowing an effect-free loop to be abandoned. */
export function emptyFailureDiagnostic(message: AgentMessage): boolean {
  return (
    message.role === "assistant" &&
    ["error", "aborted"].includes(message.stopReason) &&
    Array.isArray(message.content) &&
    message.content.every((part) =>
      part.type === "text"
        ? part.text === "" &&
          Object.keys(part).every((key) => ["type", "text"].includes(key))
        : part.type === "thinking"
          ? part.thinking === "" &&
            Object.keys(part).every((key) => ["type", "thinking"].includes(key))
          : false,
    )
  );
}
export function withdrawAttachmentInput(
  host: Host,
  inputID: string,
  requestID: string,
  expectedRevision: number,
) {
  const store = host.store,
    input = store.get<Input>("Input", inputID),
    session = host.session;
  if (input.revision !== expectedRevision)
    throw new ApiError("REVISION_CONFLICT", 409);
  const unsafe = () => {
    throw new ApiError("WITHDRAWAL_UNSAFE", 409);
  };
  if (
    !input.attachments?.length ||
    input.session_id !== host.sessionID ||
    !["ACCEPTED", "CLAIMED"].includes(input.state) ||
    !host.withdrawalIdle
  )
    return unsafe();
  const withdrawn = revise(input, {
    state: "WITHDRAWN",
    withdrawal: { request_id: requestID, at: now(), reason: "OWNER_WITHDRAWN" },
  });
  const scope = {
    session_id: host.sessionID,
    task_id: null,
    execution_id: null,
  };
  const event = store.event("input.withdrawn", withdrawn, scope, "MASTER_UI");
  const records: Stored[] = [withdrawn],
    events = [event];
  if (input.state === "CLAIMED") {
    if (
      !["RECOVERY_BLOCKED", "CAPACITY_BLOCKED"].includes(session.state) ||
      session.active_loop_id !== input.loop_id ||
      session.claimed_input_ids.length !== 1 ||
      session.claimed_input_ids[0] !== input.id
    )
      return unsafe();
    const contexts = store
      .all<Context>("Context")
      .filter(
        (c) => c.session_id === input.session_id && c.loop_id === input.loop_id,
      );
    const contextIDs = new Set(contexts.map((c) => c.id));
    const calls = store
      .all<ModelCall>("ModelCall")
      .filter((c) => contextIDs.has(c.context_id));
    if (
      calls.some(
        (c) =>
          ["IN_FLIGHT", "RESPONSE_SAVED"].includes(c.state) ||
          (c.response !== null &&
            !(
              ["FAILED", "INTERRUPTED"].includes(c.state) &&
              emptyFailureDiagnostic(store.read<AgentMessage>(c.response))
            )),
      )
    )
      return unsafe();
    const first = store.projectionFrames.find((f) =>
      f.mutations.some(
        (m) =>
          m.object_type === "Input" &&
          m.object_id === input.id &&
          store.read<Input>(m.snapshot).loop_id === input.loop_id,
      ),
    )?.sequence;
    if (!first) return unsafe();
    if (
      store
        .all<Operation>("Operation")
        .some(
          (o) =>
            o.scope.session_id === host.sessionID &&
            store.firstSequence("Operation", o.id) >= first,
        )
    )
      return unsafe();
    for (const frame of store.projectionFrames.filter(
      (f) => f.sequence >= first,
    )) {
      for (const e of frame.log_records) {
        if (e.scope.session_id !== host.sessionID) continue;
        if (e.event_type.startsWith("main.tool.")) return unsafe();
        if (
          e.event_type === "main.message" &&
          store.read<AgentMessage>(e.payload).role === "assistant" &&
          !emptyFailureDiagnostic(store.read<AgentMessage>(e.payload))
        )
          return unsafe();
      }
    }
    const source =
      contexts.filter((c) => c.capture_kind === "CHECKPOINT").at(-1) ??
      (session.last_context_id
        ? store.get<Context>("Context", session.last_context_id)
        : undefined);
    let messages = source ? store.read<AgentMessage[]>(source.raw_context) : [];
    let found = false;
    const notice = attachmentMessage(store, withdrawn, "withdrawn");
    messages = messages.map((m) => {
      if (attachmentTag(m)?.input_id !== input.id) return m;
      if (!source || attachmentOwner(store, m, source).id !== input.id || found)
        return unsafe();
      found = true;
      return notice;
    });
    if (source?.loop_id === input.loop_id) {
      const index = messages.findIndex(
        (m) => attachmentTag(m)?.input_id === input.id,
      );
      if (
        source.pending_tool_call_ids.length ||
        messages
          .slice(Math.max(0, index + 1))
          .some(
            (m) =>
              (m.role === "assistant" && !emptyFailureDiagnostic(m)) ||
              m.role === "toolResult",
          )
      )
        return unsafe();
      // Only the abandoned loop's empty diagnostic tail may be omitted.
      messages = messages.filter(
        (m, at) => at <= index || !emptyFailureDiagnostic(m),
      );
    }
    if (!found) messages.push(notice);
    const built = buildContext(
      store,
      messages,
      scope,
      "MAIN",
      host.model.id,
      input.loop_id!,
      host.model.contextWindow,
      { inputIDs: [], captureKind: "CHECKPOINT" },
    );
    if (built.context.pending_tool_call_ids.length) return unsafe();
    records.push(
      built.context,
      revise(session, {
        state: "IDLE",
        active_loop_id: null,
        claimed_input_ids: [],
        recovery_error: null,
        model_blocked_call: null,
        last_context_id: built.context.id,
      }),
    );
    events.push(built.event);
  }
  // withAdmission attaches ApiCommand to this one frame, never to earlier CAS writes.
  store.commit(records, events);
  setImmediate(() => {
    void host.drain().catch(() => {});
  });
  return withdrawn;
}
