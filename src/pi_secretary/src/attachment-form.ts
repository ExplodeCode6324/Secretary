import type { Input, ObjectRef, Context } from "./contracts.ts";
import type { AgentMessage } from "./model.ts";
import { hash, type Store } from "./store.ts";
import { imageLeaves } from "./vision.ts";
import { messageIdentityHash } from "./message-identity.ts";
import { contentText } from "@earendil-works/pi-ai";
// Cache immutable references only; every authentication still verifies source
// bytes. Advancing the journal extends this index without rescanning payloads.
const acceptedIndexes = new WeakMap<
  Store,
  {
    sequence: number;
    inputs: Map<
      string,
      { event: import("./contracts.ts").OperationLogRecord; sequence: number }
    >;
    owned: Set<string>;
  }
>();
function indexedSources(store: Store) {
  let index = acceptedIndexes.get(store);
  if (!index) {
    index = { sequence: 0, inputs: new Map(), owned: new Set() };
    acceptedIndexes.set(store, index);
  }
  for (const frame of store.projectionFrames.slice(index.sequence)) {
    for (const event of frame.log_records)
      if (event.event_type === "input.accepted") {
        const input = store.read<Input>(event.payload);
        if (!index.inputs.has(input.id))
          index.inputs.set(input.id, { event, sequence: frame.sequence });
      }
    for (const event of frame.log_records)
      if (event.event_type === "main.message")
        index.owned.add(event.scope.session_id + ":" + event.payload.sha256);
    for (const mutation of frame.mutations)
      if (mutation.object_type === "Context") {
        const context = store.read<Context>(mutation.snapshot);
        for (const message of context.messages)
          index.owned.add(context.session_id + ":" + message.content.sha256);
      }
    index.sequence = frame.sequence;
  }
  return index;
}
const acceptedSource = (store: Store, inputID: string) =>
  indexedSources(store).inputs.get(inputID);
function ownedMessage(store: Store, input: Input, message: AgentMessage) {
  return indexedSources(store).owned.has(
    input.session_id + ":" + hash(JSON.stringify(message)),
  );
}
function embeddedContent(store: Store, input: Input, message: AgentMessage) {
  const leaves = imageLeaves(message);
  if (
    JSON.stringify(leaves.map((i) => [i.mime, i.sha256, i.bytes])) !==
    JSON.stringify(
      input.attachments!.map((a) => [
        a.content.media_type,
        a.content.sha256,
        a.content.bytes,
      ]),
    )
  )
    throw Error("ATTACHMENT_CONTENT_MISMATCH");
  const text = store.bytes(input.payload).toString();
  return [
    ...(text ? [{ type: "text", text }] : []),
    ...leaves.map((i) => ({ type: "image", data: i.data, mimeType: i.mime })),
  ];
}
type Mode = "full" | "stub" | "withdrawn";
type Tag = {
  version: 2;
  session_id: string;
  input_id: string;
  input_content_digest: string;
  mode: Mode;
  source_event_id: string;
  journal_sequence: number;
  journal_digest: string;
  withdrawal_request_id?: string;
};
export function attachmentDigest(
  input: Pick<Input, "payload" | "attachments">,
) {
  return hash(
    JSON.stringify({
      version: 2,
      text_sha256: input.payload.sha256,
      attachments: input.attachments!.map((a) => ({
        attachment_id: a.attachment_id,
        sha256: a.content.sha256,
        bytes: a.content.bytes,
        media_type: a.content.media_type,
      })),
    }),
  );
}
export function attachmentTag(message: AgentMessage): Tag | undefined {
  const tag = (message as unknown as { secretary_input?: Tag }).secretary_input;
  return tag?.version === 2 ? tag : undefined;
}
function metadata(input: Input) {
  return input.attachments!.map((a) => ({
    attachment_id: a.attachment_id,
    sha256: a.content.sha256,
    name: a.name,
    media_type: a.content.media_type,
    bytes: a.content.bytes,
    width: a.width,
    height: a.height,
  }));
}
export function attachmentContent(store: Store, input: Input, mode: Mode) {
  const text =
    mode === "withdrawn" ? "" : store.bytes(input.payload).toString();
  if (mode === "full")
    return [
      ...(text ? [{ type: "text" as const, text }] : []),
      ...input.attachments!.map((a) => ({
        type: "image" as const,
        data: store.bytes(a.content).toString("base64"),
        mimeType: a.content.media_type,
      })),
    ];
  return [
    ...(text ? [{ type: "text" as const, text }] : []),
    {
      type: "text" as const,
      text:
        mode === "withdrawn"
          ? `Input ${input.id} withdrawn by owner; this entire input must not be executed. Attachments: ${JSON.stringify(metadata(input))}`
          : `Attachment metadata only; this request contains no pixels for these images. To inspect them again, the owner must explicitly resend the ready attachment IDs: ${JSON.stringify(metadata(input))}`,
    },
  ];
}
export function attachmentMessage(
  store: Store,
  input: Input,
  mode: Mode = "full",
): AgentMessage {
  const source = acceptedSource(store, input.id)?.event;
  if (!source || input.content_digest !== attachmentDigest(input))
    throw Error("ATTACHMENT_SOURCE_MISMATCH");
  const tag: Tag = {
    version: 2,
    session_id: input.session_id,
    input_id: input.id,
    input_content_digest: input.content_digest,
    mode,
    source_event_id: source.event_id,
    journal_sequence: store.sequence,
    journal_digest: store.digest,
    ...(mode === "withdrawn"
      ? { withdrawal_request_id: input.withdrawal!.request_id }
      : {}),
  };
  return {
    role: "user",
    content: attachmentContent(store, input, mode),
    timestamp: Date.parse(input.received_at),
    secretary_input: tag,
  } as AgentMessage;
}
export type FormBoundary = {
  session_id: string;
  journal_sequence: number;
  journal_digest: string;
};
function boundary(store: Store, sequence: number, digest: string) {
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 0 ||
    (sequence === 0
      ? "0".repeat(64)
      : store.projectionFrames[sequence - 1]?.digest) !== digest
  )
    throw Error("ATTACHMENT_BOUNDARY_MISMATCH");
}
/** Canonical rendering plus immutable accepted event and frozen state proof, never tag-only authority. */
export function attachmentForm(
  store: Store,
  message: AgentMessage,
  target?: FormBoundary,
  sourceEvidence?: ObjectRef,
) {
  const tag = attachmentTag(message);
  if (!tag) return undefined;
  const limit = target?.journal_sequence ?? store.sequence;
  if (target) boundary(store, target.journal_sequence, target.journal_digest);
  boundary(store, tag.journal_sequence, tag.journal_digest);
  if (
    tag.journal_sequence > limit ||
    message.role !== "user" ||
    !["full", "stub", "withdrawn"].includes(tag.mode) ||
    (target && target.session_id !== tag.session_id)
  )
    throw Error("ATTACHMENT_FORM_INVALID");
  if (
    sourceEvidence &&
    hash(JSON.stringify(store.read(sourceEvidence))) !==
      hash(JSON.stringify(message))
  )
    throw Error("ATTACHMENT_SOURCE_MISMATCH");
  const event = store.eventById(tag.source_event_id);
  const eventFrame = acceptedSource(store, tag.input_id);
  if (
    !event ||
    event.event_type !== "input.accepted" ||
    event.actor !== "MASTER_UI" ||
    event.scope.session_id !== tag.session_id ||
    !eventFrame ||
    eventFrame.event.event_id !== event.event_id ||
    eventFrame.sequence > tag.journal_sequence
  )
    throw Error("ATTACHMENT_SOURCE_MISMATCH");
  const original = store.read<Input>(event.payload),
    input = store.get<Input>("Input", tag.input_id);
  if (
    !original.attachments?.length ||
    original.id !== input.id ||
    input.producer !== "MASTER" ||
    input.session_id !== tag.session_id ||
    message.timestamp !== Date.parse(input.received_at) ||
    attachmentDigest(original) !== tag.input_content_digest ||
    attachmentDigest(input) !== tag.input_content_digest ||
    input.content_digest !== tag.input_content_digest
  )
    throw Error("ATTACHMENT_FORM_INVALID");
  if (tag.mode === "stub") {
    let frozen: Input | undefined;
    for (const frame of store.projectionFrames) {
      if (frame.sequence > tag.journal_sequence) break;
      for (const m of frame.mutations)
        if (m.object_type === "Input" && m.object_id === input.id)
          frozen = store.read<Input>(m.snapshot);
    }
    if (frozen?.state !== "HANDLED")
      throw Error("ATTACHMENT_STUB_BEFORE_HANDLED");
  }
  if (tag.mode === "withdrawn") {
    const proof = store.projectionFrames.find(
      (f) =>
        f.sequence <= limit &&
        f.log_records.some(
          (e) =>
            e.event_type === "input.withdrawn" &&
            store.read<Input>(e.payload).id === input.id &&
            store.read<Input>(e.payload).withdrawal?.request_id ===
              tag.withdrawal_request_id,
        ),
    );
    if (!proof || input.withdrawal?.request_id !== tag.withdrawal_request_id)
      throw Error("ATTACHMENT_WITHDRAWAL_MISMATCH");
  }
  if (
    JSON.stringify(message.content) !==
    JSON.stringify(
      tag.mode === "full" &&
        input.state === "HANDLED" &&
        ownedMessage(store, input, message)
        ? embeddedContent(store, original, message)
        : attachmentContent(store, original, tag.mode),
    )
  )
    throw Error("ATTACHMENT_CONTENT_MISMATCH");
  return {
    input,
    mode: tag.mode,
    typedText:
      tag.mode === "withdrawn"
        ? null
        : store.bytes(original.payload).toString(),
    identityKey: hash(
      JSON.stringify({
        version: 2,
        role: message.role,
        timestamp: message.timestamp,
        session_id: tag.session_id,
        input_id: tag.input_id,
        input_content_digest: tag.input_content_digest,
      }),
    ),
    originalDigest: tag.input_content_digest,
    renderedDigest: hash(JSON.stringify(message.content)),
  };
}
/** Safe metadata authorization for withdrawal; never certifies full binary integrity. */
export function attachmentOwner(
  store: Store,
  message: AgentMessage,
  owner: Context,
) {
  const tag = attachmentTag(message);
  if (
    !tag ||
    !owner.messages.some(
      (m) => m.content.sha256 === hash(JSON.stringify(message)),
    )
  )
    throw Error("ATTACHMENT_SOURCE_MISMATCH");
  const input = store.get<Input>("Input", tag.input_id);
  const source = store.logs.find(
    (e) =>
      e.event_id === tag.source_event_id && e.event_type === "input.accepted",
  );
  if (
    !source ||
    store.read<Input>(source.payload).id !== input.id ||
    input.session_id !== owner.session_id ||
    tag.input_content_digest !== attachmentDigest(input) ||
    message.timestamp !== Date.parse(input.received_at)
  )
    throw Error("ATTACHMENT_SOURCE_MISMATCH");
  if (tag.mode !== "full" || message.role !== "user")
    throw Error("ATTACHMENT_SOURCE_MISMATCH");
  const leaves = imageLeaves(message),
    bindings = input.attachments!;
  if (
    JSON.stringify(leaves.map((i) => [i.mime, i.sha256, i.bytes])) !==
    JSON.stringify(
      bindings.map((a) => [
        a.content.media_type,
        a.content.sha256,
        a.content.bytes,
      ]),
    )
  )
    throw Error("ATTACHMENT_SOURCE_MISMATCH");
  const text = store.bytes(input.payload).toString();
  const canonical = [
    ...(text ? [{ type: "text", text }] : []),
    ...leaves.map((i) => ({ type: "image", data: i.data, mimeType: i.mime })),
  ];
  if (JSON.stringify(message.content) !== JSON.stringify(canonical))
    throw Error("ATTACHMENT_SOURCE_MISMATCH");
  return input;
}
export function typedMessageText(
  store: Store,
  message: AgentMessage,
): string | null {
  if (withdrawnSource(store, message)) return null;
  const form = attachmentForm(store, message);
  if (!form) return "content" in message ? contentText(message.content) : "";
  return form.input.state === "WITHDRAWN" ? null : form.typedText;
}
export function summaryMessage(
  store: Store,
  message: AgentMessage,
): AgentMessage | null {
  if (withdrawnSource(store, message)) return null;
  const form = attachmentForm(store, message);
  if (!form) return message;
  if (form.input.state === "WITHDRAWN") return null;
  return {
    ...message,
    content: [
      ...(form.typedText
        ? [{ type: "text" as const, text: form.typedText }]
        : []),
      {
        type: "text" as const,
        text: `Uninspected attachment metadata: ${JSON.stringify(metadata(form.input))}`,
      },
    ],
  } as AgentMessage;
}
/** Only fresh-loop projection may select new forms. Frozen Context/request readers never call this. */
export function projectAttachmentResidency(
  store: Store,
  messages: AgentMessage[],
  previousLoop?: string | null,
) {
  return messages.flatMap((message) => {
    const form = attachmentForm(store, message);
    if (!form) return [message];
    if (form.input.state === "WITHDRAWN") {
      // A withdrawal checkpoint belongs to the abandoned loop. One subsequent loop keeps its notice.
      return previousLoop && previousLoop !== form.input.loop_id
        ? []
        : [
            form.mode === "withdrawn"
              ? message
              : attachmentMessage(store, form.input, "withdrawn"),
          ];
    }
    return [
      form.input.state === "HANDLED" && form.mode !== "stub"
        ? attachmentMessage(store, form.input, "stub")
        : message,
    ];
  });
}

export function authenticatedIdentityHash(store: Store, message: AgentMessage) {
  const tag = (
    message as unknown as { secretary_input?: { input_id?: string } }
  ).secretary_input;
  const form = attachmentForm(store, message);
  if (form) return form.identityKey;
  if (
    tag?.input_id &&
    store.find<Input>("Input", tag.input_id)?.attachments?.length
  )
    throw Error("ATTACHMENT_FORM_INVALID");
  if (
    message.role === "user" &&
    Array.isArray(message.content) &&
    message.content.some((c) => c.type === "image")
  )
    throw Error("ATTACHMENT_FORM_INVALID");
  return messageIdentityHash(message);
}
export function assertActiveSourceEvents(store: Store, ids: string[]) {
  for (const id of ids) {
    const event = store.logs.find((e) => e.event_id === id);
    if (!event) continue;
    if (
      event.event_type === "input.accepted" &&
      store.get<Input>("Input", store.read<Input>(event.payload).id).state ===
        "WITHDRAWN"
    )
      throw Error("ATTACHMENT_SOURCE_WITHDRAWN");
    if (event.event_type === "main.message") {
      const tag = attachmentTag(store.read<AgentMessage>(event.payload));
      if (tag && store.get<Input>("Input", tag.input_id).state === "WITHDRAWN")
        throw Error("ATTACHMENT_SOURCE_WITHDRAWN");
    }
  }
}

export function withdrawnSource(store: Store, message: AgentMessage): boolean {
  const tag = attachmentTag(message);
  if (!tag || store.find<Input>("Input", tag.input_id)?.state !== "WITHDRAWN")
    return false;
  const input = store.get<Input>("Input", tag.input_id);
  const owned = ownedMessage(store, input, message);
  if (!owned || tag.input_content_digest !== attachmentDigest(input))
    throw Error("ATTACHMENT_SOURCE_MISMATCH");
  return true;
}
