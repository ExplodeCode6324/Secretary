import { CoreTransportError, type CoreClient } from "../core-client.ts";
import type { Core, Receipt, RequestStatus } from "../api/contracts.ts";
import {
  ClientStore,
  hash,
  sameBinding,
  type Binding,
  type OutboxEntry,
} from "./state.ts";

export type Attached = {
  client: Pick<CoreClient, "query" | "commandFrozen">;
  core: Core;
};
export type Attach = () => Promise<Attached>;
export function bindingOf(core: Core): Binding {
  if (
    core.api_version !== "1" ||
    !core.data_domain_id ||
    !["fixture", "live"].includes(core.mode)
  )
    throw Error("INVALID_CORE_IDENTITY");
  return {
    api_version: "1",
    data_domain_id: core.data_domain_id,
    mode: core.mode as Binding["mode"],
  };
}
export function validReceipt(
  value: unknown,
  requestID: string,
): value is Receipt {
  if (!value || typeof value !== "object") return false;
  const r = value as Receipt;
  return (
    r.request_id === requestID &&
    r.command === "messages" &&
    r.acceptance === "ACCEPTED" &&
    [
      "ACCEPTED",
      "QUEUED",
      "RUNNING",
      "COMPLETED",
      "FAILED",
      "UNKNOWN",
    ].includes(r.state) &&
    typeof r.revision === "string" &&
    Array.isArray(r.resource_ids) &&
    r.resource_ids.length <= 10000 &&
    r.resource_ids.every(
      (resource) =>
        resource &&
        typeof resource.type === "string" &&
        typeof resource.id === "string",
    ) &&
    (r.error_code === null || typeof r.error_code === "string")
  );
}
const rejected = new Map([
  ["INVALID_REQUEST", 400],
  ["INVALID_INPUT", 400],
  ["INVALID_JSON", 400],
  ["REQUEST_TOO_LARGE", 413],
  ["UNSUPPORTED_MEDIA_TYPE", 415],
]);

/** One dispatcher; no browser connection/generation can inherit POST authority. */
export class Outbox {
  generation = 0;
  active = false;
  needsResume = false;
  status = "disconnected; sends locked";
  observation: RequestStatus | null = null;
  onChange: () => void = () => {};
  private running?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private retrySeconds = 1;
  private closed = false;
  private abort = new AbortController();
  constructor(
    readonly store: ClientStore,
    readonly attach: Attach,
  ) {}
  connect(generation: number) {
    this.generation = generation;
    this.active = true;
    this.needsResume = this.store.state.outbox.length > 0;
    this.status = this.needsResume ? "waiting for explicit Resume" : "ready";
    this.onChange();
  }
  disconnect(generation: number) {
    if (this.generation !== generation) return;
    this.active = false;
    this.generation++;
    this.needsResume = true;
    clearTimeout(this.timer);
    this.status = "disconnected; sends locked";
    this.onChange();
  }
  resume(generation: number) {
    if (!this.active || generation !== this.generation)
      throw Error("STALE_GENERATION");
    this.needsResume = false;
    this.retrySeconds = 1;
    this.kick();
  }
  private permitted(generation: number) {
    return (
      !this.closed &&
      this.active &&
      !this.needsResume &&
      this.generation === generation &&
      this.store.writer.healthy &&
      !this.store.error
    );
  }
  private head(): OutboxEntry | undefined {
    return this.store.state.outbox.find(
      (entry) => entry.state !== "NEEDS_EDIT",
    );
  }
  private async verified(entry: OutboxEntry): Promise<Attached> {
    const attached = await this.attach(); // Fresh endpoint/core identity for every reconciliation/send.
    if (
      !sameBinding(bindingOf(attached.core), entry.binding) ||
      !sameBinding(this.store.state.binding, entry.binding)
    )
      throw Error("FOREIGN_DOMAIN_QUARANTINED");
    return attached;
  }
  /** Read-only reconciliation is allowed before Resume. GET never authorizes cleanup. */
  async observe(): Promise<void> {
    const entry = this.head();
    if (!entry?.attempted) return;
    const { client } = await this.verified(entry);
    const status = await client.query<RequestStatus>(
      "requests/" + entry.request_id,
      { signal: this.abort.signal },
    );
    if (
      !status ||
      !validReceipt(status.receipt, entry.request_id) ||
      !Array.isArray(status.resources)
    )
      throw Error("INVALID_REQUEST_STATUS");
    this.observation = status;
    this.onChange();
  }
  kick(): void {
    if (this.running || !this.permitted(this.generation)) return;
    clearTimeout(this.timer);
    this.running = this.drain()
      .catch((error) => {
        this.status = String(error);
        this.onChange();
      })
      .finally(() => {
        this.running = undefined;
        if (
          this.permitted(this.generation) &&
          this.head() &&
          this.head()?.state !== "CONFLICT"
        ) {
          this.timer = setTimeout(() => this.kick(), this.retrySeconds * 1000);
          this.retrySeconds = Math.min(30, this.retrySeconds * 2);
        }
      });
  }
  async idle() {
    await this.running;
  }
  private async drain() {
    while (this.permitted(this.generation)) {
      const entry = this.head();
      if (!entry) {
        this.status = "ready";
        this.onChange();
        return;
      }
      if (entry.state === "CONFLICT") {
        this.status = "request conflict; payload quarantined";
        this.onChange();
        return;
      }
      const generation = this.generation;
      const priorUnknown =
        entry.uncertain ||
        entry.state === "ATTEMPTED" ||
        entry.state === "UNKNOWN";
      let attached: Attached;
      try {
        attached = await this.verified(entry);
        if (entry.attempted) {
          try {
            const status = await attached.client.query<RequestStatus>(
              "requests/" + entry.request_id,
              { signal: this.abort.signal },
            );
            if (
              !status ||
              !validReceipt(status.receipt, entry.request_id) ||
              !Array.isArray(status.resources)
            )
              throw Error("INVALID_REQUEST_STATUS");
            this.observation = status;
            // A matching GET does not contain the payload fingerprint. Exact replay is mandatory.
          } catch (error) {
            if (!(
              error instanceof CoreTransportError &&
              error.route === "requests/" + entry.request_id &&
              error.status === 404 &&
              error.code === "NOT_FOUND" &&
              error.envelopeValid
            ))
              throw error;
          }
        }
        const body = await this.store.writer.read(entry.body);
        if (
          hash(body) !== entry.body_sha256 ||
          JSON.parse(body).request_id !== entry.request_id
        )
          throw Error("CORRUPT_FROZEN_BODY");
        if (!this.permitted(generation)) return;
        await this.store.update(
          entry.request_id,
          (current) => {
            current.state = "ATTEMPTED";
            current.attempted = true;
            current.uncertain = priorUnknown;
          },
          "input-ack",
        );
        // No await between this guard and initiating HTTP. Disconnect during fsync must not POST.
        if (!this.permitted(generation)) return;
        this.status = "sending frozen request " + entry.request_id;
        this.onChange();
        try {
          const receipt = await attached.client.commandFrozen(
            "messages",
            body,
            entry.request_id,
            entry.body_sha256,
            { signal: this.abort.signal },
          );
          if (!validReceipt(receipt, entry.request_id))
            throw Error("INVALID_POST_RECEIPT");
          await this.store.handoff(entry.request_id, receipt);
          this.retrySeconds = 1;
          this.status = "received by Core; business outcome follows timeline";
          this.onChange();
        } catch (error) {
          const transport = error instanceof CoreTransportError ? error : null;
          const conflict =
            transport?.envelopeValid &&
            transport.code === "REQUEST_CONFLICT" &&
            transport.status === 409;
          const knownRejected =
            !priorUnknown &&
            transport?.envelopeValid &&
            rejected.get(transport.code) === transport.status;
          await this.store.update(entry.request_id, (current) => {
            current.state = conflict
              ? "CONFLICT"
              : knownRejected
                ? "NEEDS_EDIT"
                : "UNKNOWN";
            current.uncertain = !knownRejected;
            current.last_error = transport?.code ?? "UNKNOWN_RESPONSE";
          });
          this.status = conflict
            ? "request conflict; body retained"
            : knownRejected
              ? "rejected before admission; body retained for edit"
              : "outcome unknown; original ID and bytes retained";
          this.onChange();
          if (!knownRejected) return;
        }
      } catch (error) {
        this.status = String(error);
        this.onChange();
        return;
      }
    }
  }
  async retry(requestID: string, generation: number) {
    if (!this.active || generation !== this.generation)
      throw Error("STALE_GENERATION");
    const entry = this.store.state.outbox.find(
      (x) => x.request_id === requestID,
    );
    if (!entry) throw Error("OUTBOX_NOT_FOUND");
    if (entry.state === "CONFLICT") throw Error("CONFLICT_QUARANTINED");
    await this.store.update(requestID, (current) => {
      current.state = current.uncertain ? "UNKNOWN" : "PREPARED";
    });
    // Retry does not bypass a reconnect's Resume barrier.
    this.kick();
  }
  close() {
    this.abort.abort();
    this.closed = true;
    this.active = false;
    clearTimeout(this.timer);
  }
}
