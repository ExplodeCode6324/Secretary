import { createHash, randomUUID } from "node:crypto";
import type { Receipt } from "../api/contracts.ts";
import {
  Editor,
  emptyDraft,
  type EditorState,
  type TextNode,
} from "./editor.ts";
import {
  blobOf,
  StateWriter,
  type BlobRef,
  type BlobWrite,
  type CommitIntent,
} from "./writer.ts";
import type { View } from "./commands.ts";

export type Binding = {
  api_version: "1";
  data_domain_id: string;
  mode: "live" | "fixture";
};
export const sameBinding = (a: Binding | null, b: Binding | null) =>
  !!a &&
  !!b &&
  a.api_version === b.api_version &&
  a.data_domain_id === b.data_domain_id &&
  a.mode === b.mode;
export const hash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export type EntryState =
  "PREPARED" | "ATTEMPTED" | "UNKNOWN" | "NEEDS_EDIT" | "CONFLICT";
export type Producer =
  | { class: "browser-structured"; policy: "issue82-r7" }
  | { class: "terminal-bracketed-paste"; policy: "issue82-terminal-r1" };
export function supportedProducer(value: unknown): value is Producer {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Producer;
  return (
    Object.keys(p).sort().join() === "class,policy" &&
    ((p.class === "browser-structured" && p.policy === "issue82-r7") ||
      (p.class === "terminal-bracketed-paste" &&
        p.policy === "issue82-terminal-r1"))
  );
}
export type OutboxEntry = {
  request_id: string;
  sequence: number;
  body: BlobRef;
  body_sha256: string;
  method: "POST";
  route: "messages";
  binding: Binding;
  state: EntryState;
  attempted: boolean;
  uncertain: boolean;
  producer: Producer;
  origin: View;
  revision: number;
  created_at: string;
  last_error: string | null;
};
type StoredNode = Omit<TextNode, "text"> & { body: BlobRef };
type StoredEditor = {
  draft: Omit<EditorState["draft"], "nodes"> & { nodes: StoredNode[] };
  undo: Array<
    Omit<EditorState["undo"][number], "inserted" | "removed"> & {
      inserted: StoredNode[];
      removed: StoredNode[];
    }
  >;
  redo: StoredEditor["undo"];
};
export type ReceiptRecord = {
  request_id: string;
  sequence: number;
  body: BlobRef;
  created_at: string;
};
export type ClientState = {
  version: 1;
  binding: Binding | null;
  editors: Record<View, StoredEditor>;
  outbox: OutboxEntry[];
  receipts: ReceiptRecord[];
  next_sequence: number;
  view: View;
  anchor: { message_id?: string; event_id?: string; offset: number } | null;
};

function refs(
  value: unknown,
  out = new Map<string, BlobRef>(),
): Map<string, BlobRef> {
  if (Array.isArray(value)) for (const child of value) refs(child, out);
  else if (value && typeof value === "object") {
    if ("blob" in value) out.set(String(value.blob), value as BlobRef);
    else for (const child of Object.values(value)) refs(child, out);
  }
  return out;
}

/** Serial durable transactions; live editor revisions remain distinct from saved ACKs. */
export class ClientStore {
  readonly editors: Record<View, Editor> = {
    Main: new Editor(),
    Task: new Editor(),
  };
  readonly savedRevision: Record<View, number> = { Main: -1, Task: -1 };
  state!: ClientState;
  error: string | null = null;
  readOnly = false;
  private chain: Promise<unknown> = Promise.resolve();
  private known = new Map<string, BlobRef>();
  private debounce?: ReturnType<typeof setTimeout>;
  private maximum?: ReturnType<typeof setTimeout>;
  private savePending = false;
  private closed = false;
  private opened = false;
  onChange: () => void = () => {};
  constructor(
    readonly writer: StateWriter,
    readonly maxOutbox = 1000,
  ) {}
  async open() {
    if (this.opened || this.closed) throw Error("STATE_ALREADY_OPEN_OR_CLOSED");
    await this.writer.ready;
    const data = this.writer.data as ClientState | null;
    if (!data) {
      this.state = {
        version: 1,
        binding: null,
        editors: {} as Record<View, StoredEditor>,
        outbox: [],
        receipts: [],
        next_sequence: 1,
        view: "Main",
        anchor: null,
      };
      await this.transaction(() => ({ result: undefined }), "input-ack", true);
      this.opened = true;
      return;
    }
    if (
      data.version !== 1 ||
      !Array.isArray(data.outbox) ||
      data.outbox.length > this.maxOutbox ||
      !Array.isArray(data.receipts) ||
      data.receipts.length > 50 ||
      !Number.isSafeInteger(data.next_sequence) ||
      !["Main", "Task"].includes(data.view)
    )
      throw Error("CORRUPT_CLIENT_STATE");
    this.known = refs(data);
    for (const view of ["Main", "Task"] as const) {
      const saved = data.editors[view];
      const load = async (nodes: StoredNode[]) =>
        Promise.all(
          nodes.map(async ({ body, ...node }) => ({
            ...node,
            text: await this.writer.read(body),
          })),
        );
      const history = async (items: StoredEditor["undo"]) =>
        Promise.all(
          items.map(async (item) => ({
            ...item,
            inserted: await load(item.inserted),
            removed: await load(item.removed),
          })),
        );
      this.editors[view] = Editor.restore({
        draft: { ...saved.draft, nodes: await load(saved.draft.nodes) },
        undo: await history(saved.undo),
        redo: await history(saved.redo),
      });
      this.savedRevision[view] = saved.draft.revision;
    }
    const ids = new Set<string>();
    let last = 0;
    for (const entry of data.outbox) {
      if (
        !/^[a-f0-9-]{36}$/.test(entry.request_id) ||
        ids.has(entry.request_id) ||
        !Number.isSafeInteger(entry.sequence) ||
        entry.sequence <= last ||
        ![
          "PREPARED",
          "ATTEMPTED",
          "UNKNOWN",
          "NEEDS_EDIT",
          "CONFLICT",
        ].includes(entry.state) ||
        entry.method !== "POST" ||
        entry.route !== "messages" ||
        typeof entry.attempted !== "boolean" ||
        typeof entry.uncertain !== "boolean" ||
        !supportedProducer(entry.producer)
      )
        throw Error("CORRUPT_OUTBOX");
      ids.add(entry.request_id);
      last = entry.sequence;
    }
    if (data.next_sequence <= last) throw Error("CORRUPT_SEQUENCE");
    this.state = data;
    this.opened = true;
  }
  private capture(): {
    editors: Record<View, StoredEditor>;
    blobs: BlobWrite[];
    revisions: Record<View, number>;
  } {
    const blobs: BlobWrite[] = [],
      seen = new Map(this.known);
    const storeNodes = (nodes: TextNode[]): StoredNode[] =>
      nodes.map(({ text, ...node }) => {
        let ref = seen.get(node.id);
        if (
          ref &&
          (ref.sha256 !== hash(text) || ref.bytes !== Buffer.byteLength(text))
        )
          throw Error("MUTATED_IMMUTABLE_NODE");
        if (!ref) {
          const blob = blobOf(text, node.id);
          blobs.push(blob);
          ref = blob.ref;
          seen.set(node.id, ref);
        }
        return { ...node, body: ref };
      });
    const editors = {} as Record<View, StoredEditor>,
      revisions = {} as Record<View, number>;
    for (const view of ["Main", "Task"] as const) {
      const value = this.editors[view].snapshot();
      revisions[view] = value.draft.revision;
      const history = (items: EditorState["undo"]) =>
        items.map((item) => ({
          ...item,
          inserted: storeNodes(item.inserted),
          removed: storeNodes(item.removed),
        }));
      editors[view] = {
        draft: { ...value.draft, nodes: storeNodes(value.draft.nodes) },
        undo: history(value.undo),
        redo: history(value.redo),
      };
    }
    return { editors, blobs, revisions };
  }
  private transaction<T>(
    change: (
      state: ClientState,
      capture: ReturnType<ClientStore["capture"]>,
    ) => {
      result: T;
      blobs?: BlobWrite[];
      retire?: Record<string, "handoff" | "discard">;
    },
    intent: CommitIntent = "maintenance",
    initialize = false,
  ): Promise<T> {
    if (!this.opened && !initialize)
      return Promise.reject(Error("STATE_NOT_OPEN"));
    const run = async () => {
      if (!this.opened && !initialize) throw Error("STATE_NOT_OPEN");
      if (this.readOnly) throw Error("FOREIGN_DOMAIN_QUARANTINED");
      if (this.closed || !this.writer.healthy) throw Error("STATE_UNAVAILABLE");
      const captured = this.capture(),
        next = structuredClone(this.state);
      next.editors = captured.editors;
      const operation = change(next, captured);
      const beforeEditors = refs(this.state.editors),
        after = refs(next);
      const retire: Record<string, "superseded" | "handoff" | "discard"> = {
        ...operation.retire,
      };
      for (const [id] of beforeEditors)
        if (!after.has(id)) retire[id] = "superseded";
      await this.writer.commit(
        next,
        [...captured.blobs, ...(operation.blobs ?? [])].filter((blob) =>
          after.has(blob.ref.blob),
        ),
        retire,
        intent,
      );
      this.state = next;
      this.known = refs(next);
      for (const view of ["Main", "Task"] as const)
        this.savedRevision[view] = next.editors[view].draft.revision;
      this.error = null;
      this.onChange();
      return operation.result;
    };
    const task = this.chain.then(run);
    this.chain = task.catch((error) => {
      this.error = String(error);
      this.onChange();
    });
    return task;
  }
  save(): Promise<void> {
    return this.transaction(() => ({ result: undefined }), "input-ack");
  }
  edited() {
    if (!this.opened) throw Error("STATE_NOT_OPEN");
    if (this.closed || this.readOnly) return;
    this.onChange();
    clearTimeout(this.debounce);
    const save = () => {
      clearTimeout(this.debounce);
      clearTimeout(this.maximum);
      this.maximum = undefined;
      if (this.savePending) return;
      this.savePending = true;
      void this.save()
        .catch(() => {})
        .finally(() => {
          this.savePending = false;
          if (
            ["Main", "Task"].some(
              (view) =>
                this.savedRevision[view as View] !==
                this.editors[view as View].draft.revision,
            ) &&
            !this.error
          )
            this.edited();
        });
    };
    this.debounce = setTimeout(save, 150);
    this.maximum ??= setTimeout(save, 1000);
  }
  async bind(binding: Binding) {
    if (!this.opened) throw Error("STATE_NOT_OPEN");
    if (this.state.binding && !sameBinding(this.state.binding, binding))
      throw Error("FOREIGN_DOMAIN_QUARANTINED");
    if (!this.state.binding)
      await this.transaction((next) => {
        next.binding = binding;
        return { result: undefined };
      });
  }
  async enqueue(
    view: View,
    text: string,
    binding: Binding,
    revision: number,
  ): Promise<OutboxEntry> {
    if (!this.opened) throw Error("STATE_NOT_OPEN");
    if (!sameBinding(this.state.binding, binding))
      throw Error("BINDING_MISMATCH");
    if (!text.trim()) throw Error("EMPTY_INPUT");
    if (this.editors[view].draft.attachment_ids.length)
      throw Error("ATTACHMENTS_NOT_IMPLEMENTED");
    const request_id = randomUUID(),
      body = JSON.stringify({ request_id, text, attachment_ids: [] });
    if (Buffer.byteLength(body) > 1048576) throw Error("REQUEST_TOO_LARGE");
    const blob = blobOf(body),
      created_at = new Date().toISOString();
    const result = await this.transaction((next) => {
      if (next.outbox.length >= this.maxOutbox) throw Error("OUTBOX_QUOTA");
      const entry: OutboxEntry = {
        request_id,
        sequence: next.next_sequence++,
        body: blob.ref,
        body_sha256: hash(body),
        method: "POST",
        route: "messages",
        binding,
        state: "PREPARED",
        attempted: false,
        uncertain: false,
        producer: {
          class: "terminal-bracketed-paste",
          policy: "issue82-terminal-r1",
        },
        origin: view,
        revision,
        created_at,
        last_error: null,
      };
      next.outbox.push(entry);
      if (next.editors[view].draft.revision === revision)
        next.editors[view] = {
          draft: { ...emptyDraft(), nodes: [], revision: revision + 1 },
          undo: [],
          redo: [],
        };
      return { result: entry, blobs: [blob] };
    }, "input-ack");
    if (this.editors[view].draft.revision === revision)
      this.editors[view] = new Editor({
        ...emptyDraft(),
        revision: revision + 1,
      });
    else this.edited();
    this.onChange();
    return result;
  }
  async update(
    requestID: string,
    mutate: (entry: OutboxEntry) => void,
    intent: CommitIntent = "maintenance",
  ) {
    return this.transaction((next) => {
      const entry = next.outbox.find((x) => x.request_id === requestID);
      if (!entry) throw Error("OUTBOX_NOT_FOUND");
      mutate(entry);
      return { result: structuredClone(entry) };
    }, intent);
  }
  async handoff(requestID: string, receipt: Receipt) {
    if (
      receipt.request_id !== requestID ||
      receipt.command !== "messages" ||
      receipt.acceptance !== "ACCEPTED"
    )
      throw Error("INVALID_RECEIPT");
    return this.transaction((next) => {
      const entry = next.outbox.find((x) => x.request_id === requestID);
      if (!entry) throw Error("OUTBOX_NOT_FOUND");
      const archive = blobOf(
        JSON.stringify({
          receipt,
          binding: entry.binding,
          created_at: entry.created_at,
          cleanup_complete: true,
          sequence: entry.sequence,
        }),
      );
      archive.ref.kind = "receipt";
      next.receipts.push({
        request_id: requestID,
        sequence: entry.sequence,
        body: archive.ref,
        created_at: entry.created_at,
      });
      next.receipts = next.receipts.slice(-50); // Older immutable receipt blobs retain three calendar years.
      next.outbox = next.outbox.filter((x) => x.request_id !== requestID);
      return {
        result: undefined,
        blobs: [archive],
        retire: { [entry.body.blob]: "handoff" },
      };
    });
  }
  async discard(requestID: string) {
    return this.transaction((next) => {
      const entry = next.outbox.find((x) => x.request_id === requestID);
      if (!entry) throw Error("OUTBOX_NOT_FOUND");
      if (entry.attempted && entry.state !== "NEEDS_EDIT")
        throw Error("UNKNOWN_NOT_DISCARDABLE");
      next.outbox = next.outbox.filter((x) => x.request_id !== requestID);
      return { result: undefined, retire: { [entry.body.blob]: "discard" } };
    });
  }
  async setView(view: View) {
    await this.transaction((next) => {
      next.view = view;
      return { result: undefined };
    });
  }
  async setAnchor(anchor: ClientState["anchor"]) {
    await this.transaction((next) => {
      next.anchor = anchor;
      return { result: undefined };
    });
  }
  async flush() {
    clearTimeout(this.debounce);
    clearTimeout(this.maximum);
    await this.save();
    await this.chain;
  }
  async close() {
    if (this.opened) await this.flush();
    this.closed = true;
    return this.writer.close();
  }
}
