import type { Store } from "./store.ts";
import type {
  Feedback,
  Input,
  TaskResult,
  OperationLogRecord,
} from "./contracts.ts";
export type DeliveryReference = {
  task_id: string;
  execution_id: string;
  result_id: string;
  artifact_id: string;
};
export type ArtifactDelivery = {
  message_event_id: string;
  display_call_id?: string;
  loop_id: string;
  artifacts: DeliveryReference[];
};
/** Only this loop's claimed RESULT inputs establish a delivery; queries never do. */
export function deliveryCandidates(
  store: Store,
  inputs: Input[],
  loopID: string,
): DeliveryReference[] {
  const out: DeliveryReference[] = [],
    seen = new Set<string>();
  for (const input of inputs) {
    const claimed = store.get<Input>("Input", input.id);
    if (
      claimed.state !== "CLAIMED" ||
      claimed.loop_id !== loopID ||
      !claimed.feedback_id
    )
      continue;
    const feedback = store.get<Feedback>("Feedback", claimed.feedback_id);
    if (feedback.kind !== "RESULT" || !feedback.result_id) continue;
    const result = store.get<TaskResult>("TaskResult", feedback.result_id);
    if (
      result.task_id !== feedback.task_id ||
      result.execution_id !== feedback.execution_id
    )
      throw Error("DELIVERY_RESULT_SCOPE_MISMATCH");
    for (const artifact of result.artifacts) {
      if (seen.has(artifact.artifact_id)) continue;
      seen.add(artifact.artifact_id);
      out.push({
        task_id: result.task_id,
        execution_id: result.execution_id,
        result_id: result.id,
        artifact_id: artifact.artifact_id,
      });
    }
  }
  return out;
}
const indexes = new WeakMap<Store, Deliveries>();
export function deliveriesFor(store: Store) {
  let index = indexes.get(store);
  if (!index) {
    index = new Deliveries(store);
    indexes.set(store, index);
  }
  index.sync();
  return index;
}
class Deliveries {
  private position = 0;
  private events = new Map<string, ArtifactDelivery>();
  private loops = new Set<string>();
  constructor(private store: Store) {}
  sync() {
    for (; this.position < this.store.projectionFrames.length; this.position++)
      for (const event of this.store.projectionFrames[this.position]
        .log_records)
        if (event.event_type === "main.delivery") {
          const delivery = this.store.read<ArtifactDelivery>(event.payload);
          if (!this.events.has(delivery.message_event_id))
            this.events.set(delivery.message_event_id, delivery);
          this.loops.add(delivery.loop_id);
        }
  }
  forEvent(event: string | undefined) {
    return event ? this.events.get(event) : undefined;
  }
  forLoop(loop: string) {
    return this.loops.has(loop);
  }
}
export function deliveryEvent(
  store: Store,
  message: OperationLogRecord,
  body: any,
  inputs: Input[],
  loopID: string,
  displayCallID?: string,
) {
  if (
    body.role !== "assistant" ||
    !["stop", "length"].includes(body.stopReason) ||
    body.content.some((b: any) => b.type === "toolCall") ||
    deliveriesFor(store).forLoop(loopID)
  )
    return [];
  const artifacts = deliveryCandidates(store, inputs, loopID);
  if (!artifacts.length) return [];
  return [
    store.event(
      "main.delivery",
      {
        message_event_id: message.event_id,
        ...(displayCallID ? { display_call_id: displayCallID } : {}),
        loop_id: loopID,
        artifacts,
      } satisfies ArtifactDelivery,
      message.scope,
      "MAIN",
    ),
  ];
}
