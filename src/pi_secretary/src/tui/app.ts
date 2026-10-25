import { randomUUID } from "node:crypto";
import { inspectCore } from "../core-client.ts";
import {
  Editor,
  displayText,
  emptyDraft,
  flatten,
  type Selection,
} from "./editor.ts";
import {
  COMMANDS,
  completions,
  parseSubmission,
  resolveID,
  type Parsed,
  type View,
} from "./commands.ts";
import { ClientStore, sameBinding, type Binding } from "./state.ts";
import { StateWriter } from "./writer.ts";
import { Outbox, bindingOf } from "./outbox.ts";
import { InputProtocol, type Action } from "./input.ts";
import { MainSync } from "./sync.ts";
import { BrowserServer, type Assets } from "./server.ts";
import type { Config } from "./config.ts";
import path from "node:path";

const exact = (event: Record<string, unknown>, fields: string[]) => {
  if (Object.keys(event).sort().join() !== fields.sort().join())
    throw Error("INVALID_EVENT_FIELDS");
};
export class TuiApp {
  readonly store: ClientStore;
  readonly outbox: Outbox;
  readonly input: InputProtocol;
  readonly sync: MainSync;
  readonly browser: BrowserServer;
  command?: Editor;
  notice =
    "CR/CRLF normalize to LF. Enter inserts a newline; Submit is explicit.";
  panel = "";
  private binding?: Binding;
  private collected = false;
  private recordID?: string;
  private restoreCandidate?: { id: string; view: View; revision: number };
  private largeEdit?: {
    editor: Editor;
    revision: number;
    sourceRevision: number;
    start: number;
    end: number;
    dismissCommand: boolean;
    view: View;
  };
  private closing = false;
  private lifetime = new AbortController();
  private publishTimer?: ReturnType<typeof setTimeout>;
  private replacement?: {
    view: View;
    revision: number;
    text: string;
    commandRevision: number;
  };
  private clipboard?: {
    id: string;
    text: string;
    offset: number;
    editor?: Editor;
    revision: number;
    selection: Selection;
    cut: boolean;
    generation: number;
    deadline: number;
  };
  private completion?: {
    prefix: string;
    choices: string[];
    index: number;
    start: number;
    end: number;
    revision: number;
  };
  onExit: (saved: boolean) => void = () => {};
  constructor(
    readonly config: Config,
    assets: Assets,
  ) {
    this.store = new ClientStore(
      new StateWriter(path.join(config.data, "tui-v1"), config.quota),
      config.maxOutbox,
    );
    const attach = async () => {
      const result = await inspectCore(
        config.data,
        config.mode,
        this.lifetime.signal,
      );
      if (
        ["IDENTITY_MISMATCH", "MODE_MISMATCH", "UNSAFE"].includes(result.status)
      )
        this.store.readOnly = true;
      if (result.status !== "ATTACHED" || !result.client || !result.core)
        throw Error(
          result.status === "STOPPED"
            ? "not running or starting; start Core separately"
            : result.status,
        );
      const binding = bindingOf(result.core);
      if (!this.store.state.binding) await this.store.bind(binding);
      if (!sameBinding(binding, this.store.state.binding)) {
        this.store.readOnly = true;
        throw Error("FOREIGN_DOMAIN_QUARANTINED");
      }
      this.store.readOnly = false;
      if (!this.collected) {
        await this.store.writer.collect();
        this.collected = true;
      }
      this.binding = binding;
      return { client: result.client, core: result.core };
    };
    this.outbox = new Outbox(this.store, attach);
    this.sync = new MainSync(this.store, attach);
    this.input = new InputProtocol(() => this.editor());
    this.browser = new BrowserServer(assets, {
      snapshot: () => this.snapshot(),
      event: (event, generation) => this.event(event, generation),
      connected: (generation) => {
        this.input.reset();
        this.outbox.connect(generation);
        void this.outbox.observe().catch((error) => {
          this.notice = String(error);
          this.publish();
        });
      },
      disconnected: (generation) => {
        this.outbox.disconnect(generation);
        this.input.reset();
        this.clipboard = undefined;
      },
      expired: () => {
        this.notice =
          "No authenticated client; URL expired. Relaunch for a fresh URL.";
        console.error(this.notice);
        void this.close();
      },
    });
    this.store.onChange = this.sync.onChange = () => this.publish();
    this.outbox.onChange = () => {
      if (this.outbox.status.startsWith("received by Core"))
        this.notice = this.outbox.status;
      this.publish();
    };
  }
  editor() {
    return this.command ?? this.store.editors[this.store.state.view];
  }
  async start() {
    await this.store.open();
    await this.sync.start();
    return this.browser.listen();
  }
  private publish() {
    if (this.publishTimer || this.closing) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = undefined;
      this.browser.publish();
    }, 16);
  }
  snapshot() {
    const editor = this.editor(),
      draft = editor.draft,
      text = flatten(draft.nodes),
      head = draft.selection.head;
    const { from, to } = editor.index.window(head);
    let offset = 0;
    let runs: Array<{
      id: string;
      start: number;
      end: number;
      kind: string;
      label?: string;
      text?: string;
      expanded: boolean;
    }> = [];
    for (const node of draft.nodes) {
      const start = offset;
      offset += node.text.length;
      if (node.kind === "paste" && !node.expanded) {
        if (offset >= from && start <= to)
          runs.push({
            id: node.id,
            start,
            end: offset,
            kind: "paste",
            expanded: false,
            label: `[pasted ${node.text.split("\n").length} lines · ${Buffer.byteLength(node.text)} bytes · ${node.id.slice(0, 8)}]`,
          });
      } else if (offset >= from && start <= to) {
        const a = Math.max(start, from),
          b = Math.min(offset, to);
        runs.push({
          id: node.id,
          start: a,
          end: b,
          kind: node.kind,
          expanded: true,
          text: node.text.slice(a - start, b - start),
        });
      }
    }
    if (runs.length > 256) {
      const center = Math.max(
        0,
        runs.findIndex((run) => run.start <= head && run.end >= head),
      );
      runs = runs.slice(Math.max(0, center - 128), center + 128);
    }
    let draftDisplayBudget = 65536;
    runs = runs.flatMap((run) => {
      if (!run.text) return [run];
      const size = Buffer.byteLength(run.text);
      if (size <= draftDisplayBudget) {
        draftDisplayBudget -= size;
        return [run];
      }
      // A single extended grapheme may itself exceed the display budget. Keep
      // canonical offsets and the caret boundary, without shipping its sole body.
      const cuts =
        head > run.start && head < run.end
          ? [run.start, head, run.end]
          : [run.start, run.end];
      return cuts.slice(0, -1).map((start, i) => ({
        ...run,
        start,
        end: cuts[i + 1],
        text: undefined,
        expanded: false,
        kind: "bounded",
        label: "[large text segment; select/copy exact text]",
      }));
    });
    const visible = this.sync.page.items.map((item) =>
      item.kind === "message"
        ? {
            id: item.id,
            role: item.role,
            text: displayText(item.text),
            outcome: item.outcome,
            input_state: item.input_state,
            request_id: item.request_id,
            event_id: item.source_event_id,
            preview: item.thinking_preview
              ? displayText(item.thinking_preview.text)
              : "",
            incomplete: item.incomplete,
            kind: item.kind,
          }
        : {
            id: item.id,
            kind: item.kind,
            event_id: item.activity.id,
            text: displayText(
              `${item.activity.kind ?? "activity"}: ${item.activity.status ?? ""} ${item.activity.phase ?? ""}`,
            ),
          },
    );
    // The browser receives a bounded viewport. Full content remains in Node's bounded cache.
    let remaining = 128 * 1024;
    const rows = visible
      .map((row) => {
        const text = Array.from(row.text)
          .slice(0, Math.min(12000, remaining / 4))
          .join("");
        remaining -= Buffer.byteLength(text);
        return { ...row, text, clipped: text.length !== row.text.length };
      })
      .filter((row) => row.text || row.kind === "message");
    const pending = this.store.state.outbox
      .filter(
        (e) =>
          !visible.some(
            (m) => "request_id" in m && m.request_id === e.request_id,
          ),
      )
      .slice(0, 50)
      .map((e) => ({ id: e.request_id, state: e.state, sequence: e.sequence }));
    const content = this.sync.selected
      ? this.sync.loaded.get(this.sync.selected)
      : undefined;
    return {
      view: this.store.state.view,
      mode: this.command ? "COMMAND" : draft.literal ? "LITERAL" : "NORMAL",
      target:
        this.store.state.view === "Main" ? "Main" : "local draft; /send → Main",
      data: this.config.data,
      coreMode: this.config.mode,
      domain: this.store.state.binding?.data_domain_id ?? "unbound",
      connection: this.sync.status,
      stale: this.sync.stale,
      revision: draft.revision,
      selection: draft.selection,
      length: text.length,
      runs,
      before: (runs[0]?.start ?? from) > 0,
      after: (runs.at(-1)?.end ?? to) < text.length,
      saved:
        !this.command &&
        this.store.savedRevision[this.store.state.view] === draft.revision,
      error: this.store.error,
      quarantine: this.store.readOnly,
      usage: this.store.writer.usage,
      quota: this.config.quota,
      outbox: this.outbox.status,
      resume: this.outbox.needsResume,
      rows,
      pending,
      selected: this.sync.selected,
      newItems: this.sync.newItems,
      anchor: this.store.state.anchor,
      following: this.sync.following,
      sessionState: this.sync.session?.state ?? "unavailable",
      previews: this.sync.previews.slice(-10).map((p) => ({
        id: "message:" + p.id,
        text: displayText(p.blocks.map((b) => b.text).join("")).slice(0, 2000),
        preview: displayText(p.thinking_preview?.text ?? "").slice(0, 256),
        status: p.status,
      })),
      expansion: content?.shown
        ? {
            id: this.sync.selected,
            text: displayText(content.text).slice(-30000),
            thinking: displayText(content.thinking).slice(-30000),
            more: !!content.next,
          }
        : null,
      notice: displayText(this.notice).slice(0, 2000),
      panel: displayText(this.panel).slice(0, 50000),
      replacement: !!this.replacement,
      largeConfirmation: !!this.largeEdit || this.input.needsConfirmation,
      record: this.recordID
        ? {
            id: this.recordID,
            editable: this.store.state.outbox.some(
              (e) => e.request_id === this.recordID && e.state === "NEEDS_EDIT",
            ),
            restoreConfirmation: this.restoreCandidate?.id === this.recordID,
          }
        : null,
    };
  }
  private writable(generation: number) {
    if (
      this.closing ||
      !this.outbox.active ||
      this.outbox.generation !== generation ||
      !this.store.writer.healthy
    )
      throw Error("STALE_GENERATION");
  }
  async event(value: unknown, generation: number) {
    const editor = this.editor(),
      revision = editor.draft.revision,
      selection = { ...editor.draft.selection },
      pendingRemoval = this.largeEdit;
    const result = await this.applyEvent(value, generation);
    if (
      editor !== this.editor() ||
      revision !== editor.draft.revision ||
      selection.anchor !== editor.draft.selection.anchor ||
      selection.head !== editor.draft.selection.head
    ) {
      this.input.invalidateConfirmation();
      if (this.largeEdit === pendingRemoval) this.largeEdit = undefined;
    }
    return result;
  }
  private async applyEvent(value: unknown, generation: number) {
    this.writable(generation);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("INVALID_EVENT");
    const event = value as Record<string, unknown>;
    if (event.type === "confirm-large" && this.largeEdit) {
      exact(event, ["type", "revision", "accept"]);
      const operation = this.largeEdit;
      this.largeEdit = undefined;
      if (typeof event.accept !== "boolean")
        throw Error("INVALID_EVENT_FIELDS");
      if (!event.accept) return;
      if (this.store.readOnly) throw Error("FOREIGN_DOMAIN_QUARANTINED");
      if (
        operation.view !== this.store.state.view ||
        event.revision !== this.editor().draft.revision ||
        operation.sourceRevision !== this.editor().draft.revision ||
        operation.revision !== operation.editor.draft.revision
      )
        throw Error("STALE_LARGE_EDIT");
      operation.editor.edit(operation.start, operation.end, "", "typed", true);
      if (operation.dismissCommand) this.command = undefined;
      if (operation.editor !== this.command) this.store.edited();
      this.notice = "Confirmed non-undoable removal applied.";
      return;
    }
    if (
      this.store.readOnly &&
      !this.command &&
      !(
        ["select", "move", "dismiss", "clipboard-ack"].includes(
          String(event.type),
        ) ||
        (event.type === "action" &&
          ["commands", "copy"].includes(String(event.action))) ||
        (event.type === "record-action" && event.action === "copy")
      )
    )
      throw Error("FOREIGN_DOMAIN_QUARANTINED");
    if (event.type === "record-action") {
      exact(event, ["type", "id", "action"]);
      const entry = this.store.state.outbox.find(
        (e) => e.request_id === event.id,
      );
      if (
        !entry ||
        event.id !== this.recordID ||
        !["copy", "restore"].includes(String(event.action))
      )
        throw Error("INVALID_RECORD_ACTION");
      const body = JSON.parse(await this.store.writer.read(entry.body));
      this.writable(generation);
      if (event.action === "copy") {
        this.copy(body.text, false, generation);
        return;
      }
      if (
        entry.state !== "NEEDS_EDIT" ||
        !sameBinding(entry.binding, this.binding ?? null)
      )
        throw Error("ONLY_KNOWN_REJECTION_EDITABLE");
      const view = this.store.state.view,
        editor = this.store.editors[view];
      if (
        this.restoreCandidate?.id !== entry.request_id ||
        this.restoreCandidate.view !== view ||
        this.restoreCandidate.revision !== editor.draft.revision
      ) {
        this.restoreCandidate = {
          id: entry.request_id,
          view,
          revision: editor.draft.revision,
        };
        this.notice =
          "Restore replaces this view's draft as one non-undoable edit. Click Confirm restore to apply; original rejected outbox body stays retained.";
        return;
      }
      const replacement = new Editor({
        ...emptyDraft(),
        revision: editor.draft.revision,
      });
      replacement.insert(body.text, "paste", true);
      this.store.editors[view] = replacement;
      await this.store.save();
      this.restoreCandidate = undefined;
      this.command = undefined;
      this.notice =
        "Rejected body restored as data. Edit and explicitly Submit to create a new tail request.";
      return;
    }
    if (event.type === "clipboard-ack") {
      exact(event, ["type", "id", "offset", "done", "success"]);
      const job = this.clipboard;
      if (
        !job ||
        job.id !== event.id ||
        job.generation !== generation ||
        job.deadline < Date.now() ||
        job.offset !== event.offset ||
        typeof event.success !== "boolean" ||
        typeof event.done !== "boolean"
      )
        throw Error("STALE_CLIPBOARD");
      if (!event.success) {
        this.clipboard = undefined;
        this.notice = "Clipboard write failed; draft unchanged.";
        return;
      }
      if (!event.done) {
        this.clipboardChunk();
        return;
      }
      if (job.offset !== job.text.length) throw Error("INCOMPLETE_CLIPBOARD");
      this.clipboard = undefined;
      if (job.cut) {
        if (this.store.readOnly) throw Error("FOREIGN_DOMAIN_QUARANTINED");
        if (job.editor !== this.editor()) throw Error("STALE_CUT");
        try {
          job.editor.cutAfterCopy(job.revision, job.selection, true);
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "NON_UNDOABLE_CONFIRMATION_REQUIRED"
          )
            this.largeEdit = {
              editor: job.editor,
              revision: job.revision,
              sourceRevision: this.editor().draft.revision,
              start: Math.min(job.selection.anchor, job.selection.head),
              end: Math.max(job.selection.anchor, job.selection.head),
              dismissCommand: false,
              view: this.store.state.view,
            };
          throw error;
        }
        this.store.edited();
      }
      this.notice = job.cut
        ? "Cut copied and removed the unchanged selection."
        : "Copied exact text.";
      return;
    }
    if (event.type === "dismiss") {
      exact(event, ["type", "revision"]);
      if (event.revision !== this.editor().draft.revision)
        throw Error("STALE_REVISION");
      this.command = undefined;
      this.replacement = undefined;
      this.panel = "";
      this.input.reset();
      return;
    }
    if (event.type === "complete") {
      exact(event, ["type", "revision"]);
      if (
        event.revision !== this.editor().draft.revision ||
        this.input.incomplete
      )
        throw Error("STALE_REVISION");
      this.complete();
      return;
    }
    if (event.type === "row-select") {
      exact(event, ["type", "id"]);
      if (typeof event.id !== "string") throw Error("INVALID_EVENT");
      await this.sync.select(event.id);
      return;
    }
    if (event.type === "viewport-anchor") {
      exact(event, ["type", "id", "offset"]);
      if (typeof event.id !== "string" || typeof event.offset !== "number")
        throw Error("INVALID_EVENT");
      await this.sync.anchor(event.id, event.offset);
      return;
    }
    const result = this.input.apply(value);
    if (result.changed || result.selection) {
      this.replacement = undefined;
      if (!this.command) this.store.edited();
    }
    if (result.action) await this.action(result.action, generation);
    if (event.type === "begin" || event.type === "chunk")
      return { unchanged: true as const };
  }
  private complete() {
    const editor = this.editor(),
      draft = editor.draft,
      text = flatten(draft.nodes),
      head = draft.selection.head;
    const start = text.slice(0, head).search(/\S*$/),
      prefix = text.slice(start, head);
    const tokenStart =
      this.completion?.revision === draft.revision
        ? this.completion.start
        : start;
    const tokenEnd =
      this.completion?.revision === draft.revision ? this.completion.end : head;
    if (!editor.typedRange(tokenStart, tokenEnd)) {
      this.completion = undefined;
      this.notice =
        "Completion applies only to typed text; pasted token unchanged.";
      return;
    }
    if (this.completion?.revision === draft.revision) {
      const c = this.completion;
      c.index = (c.index + 1) % c.choices.length;
      editor.edit(c.start, c.end, c.choices[c.index], "typed");
      c.end = c.start + c.choices[c.index].length;
      c.revision = editor.draft.revision;
    } else {
      const choices = completions(
        prefix,
        this.store.state.view,
        [
          ...this.sync.messageIDs(),
          ...draft.nodes.filter((x) => x.kind === "paste").map((x) => x.id),
          ...this.store.state.outbox.map((x) => x.request_id),
        ],
        this.config.aliases,
      );
      if (!choices.length) {
        this.notice = "No completion.";
        return;
      }
      editor.edit(start, head, choices[0], "typed");
      this.completion = {
        prefix,
        choices,
        index: 0,
        start,
        end: start + choices[0].length,
        revision: editor.draft.revision,
      };
      this.notice = choices.join(" · ");
    }
    if (!this.command) this.store.edited();
  }
  private copy(
    text: string,
    cut: boolean,
    generation: number,
    editor?: Editor,
  ) {
    if (!text) throw Error("NO_SELECTION");
    if (Buffer.byteLength(text) > 4 * 1024 * 1024)
      throw Error("CLIPBOARD_BOUND");
    this.clipboard = {
      id: randomUUID(),
      text,
      offset: 0,
      editor,
      revision: editor?.draft.revision ?? -1,
      selection: editor
        ? { ...editor.draft.selection }
        : { anchor: 0, head: 0 },
      cut,
      generation,
      deadline: Date.now() + 30000,
    };
    this.clipboardChunk();
  }
  private clipboardChunk() {
    const job = this.clipboard!;
    const start = job.offset;
    let end = Math.min(job.text.length, start + 8000);
    if (end < job.text.length && /[\uD800-\uDBFF]/.test(job.text[end - 1]))
      end--;
    job.offset = end;
    this.browser.notify({
      type: "clipboard",
      id: job.id,
      text: job.text.slice(start, end),
      offset: end,
      final: end === job.text.length,
    });
  }
  private async action(action: Action, generation: number) {
    const editor = this.editor();
    if (action === "commands") {
      this.command ??= new Editor();
      this.input.reset();
      return;
    }
    if (action === "literal") {
      editor.draft.literal = !editor.draft.literal;
      editor.draft.revision++;
      if (!this.command) this.store.edited();
      return;
    }
    if (action === "copy" || action === "cut") {
      this.copy(editor.selectedText(), action === "cut", generation, editor);
      return;
    }
    if (action === "resume") {
      this.outbox.resume(generation);
      this.notice =
        "Resume authorized for this tab; Core receipts and business outcomes remain separate.";
      return;
    }
    if (action.startsWith("scroll-")) {
      this.browser.notify({ type: action });
      return;
    }
    if (action === "submit") {
      if (this.replacement) {
        const replacement = this.replacement;
        if (
          !this.command ||
          replacement.commandRevision !== this.command.draft.revision ||
          replacement.view !== this.store.state.view ||
          replacement.revision !==
            this.store.editors[replacement.view].draft.revision
        )
          throw Error("STALE_REPLACEMENT");
        await this.send(
          replacement.text,
          replacement.view,
          replacement.revision,
        );
        this.command = undefined;
        this.replacement = undefined;
        return;
      }
      const parsed = parseSubmission(
        editor.draft,
        this.store.state.view,
        this.config.aliases,
      );
      if (parsed.kind === "message") {
        if (this.command) throw Error("COMMAND_BUFFER_REQUIRES_SLASH");
        if (this.store.state.view !== "Main") {
          await this.store.save();
          this.notice =
            "Task draft saved locally. Use /send to explicitly send to Main.";
          return;
        }
        await this.send(parsed.text, "Main", editor.draft.revision);
        return;
      }
      await this.commandAction(parsed, generation);
    }
  }
  private async send(text: string, view: View, revision: number) {
    if (!this.binding) throw Error("CORE_NOT_ATTACHED");
    await this.store.enqueue(view, text, this.binding, revision);
    this.outbox.kick();
    this.notice = this.outbox.needsResume
      ? "Queued at FIFO tail — waiting for Resume."
      : "Saved to outbox; receipt pending.";
  }
  private async commandAction(
    parsed: Extract<Parsed, { kind: "command" }>,
    generation: number,
  ) {
    const { name, args } = parsed,
      source = this.editor(),
      revision = source.draft.revision,
      view = this.store.state.view;
    if (this.store.readOnly && !["help", "outbox", "quit"].includes(name))
      throw Error("FOREIGN_DOMAIN_QUARANTINED");
    const messageID = (value?: string) =>
      value
        ? resolveID(value, this.sync.messageIDs())
        : (this.sync.selected ??
          (() => {
            throw Error("SELECT_A_MESSAGE_FIRST");
          })());
    let clearSource = true;
    if (name === "M" || name === "T") {
      await this.store.flush();
      await this.store.setView(name === "M" ? "Main" : "Task");
    } else if (name === "help")
      this.panel =
        COMMANDS.filter(
          (c) =>
            !args[0] ||
            c.name === args[0] ||
            ("alias" in c && c.alias === args[0]),
        )
          .map((c) => `/${c.name} ${c.help} [${c.scope}]`)
          .join("\n") +
        "\nEnter=newline; Ctrl+S=Submit; Ctrl+G=Commands; Ctrl+P=Literal; Ctrl+O=Copy selection; Ctrl+U/D=scroll. Footer buttons are the supported fallback. Copy/cut require clipboard success. Native Ctrl/Cmd+C never quits. Paste controls stay data. CR/CRLF normalize to LF.";
    else if (name === "quit") {
      await this.close();
      return;
    } else if (name === "send") {
      const draft = this.store.editors[view].draft;
      if (
        this.command &&
        parsed.payload !== undefined &&
        flatten(draft.nodes)
      ) {
        this.replacement = {
          view,
          revision: draft.revision,
          text: parsed.payload,
          commandRevision: revision,
        };
        this.panel =
          "Replacement candidate (explicit Submit again confirms; Escape cancels):\n" +
          parsed.payload;
        this.notice = "Existing draft preserved until second explicit Submit.";
        return;
      }
      const text = parsed.payload ?? (this.command ? flatten(draft.nodes) : "");
      await this.send(text, view, draft.revision);
      clearSource = false;
      this.command = undefined;
    } else if (name === "latest") await this.sync.latest();
    else if (name === "history")
      await this.sync.history(args[0] as "before" | "after" | undefined);
    else if (name === "select") await this.sync.select(messageID(args[0]));
    else if (name === "cotvisible" || name === "more") {
      const toggle = args[0] === "on" || args[0] === "off" ? args[0] : args[1];
      const id = messageID(
        args[0] === "on" || args[0] === "off" ? undefined : args[0],
      );
      this.sync.selected = id;
      const loaded = this.sync.loaded.get(id);
      if (name === "more")
        await this.sync.more(id, !!(loaded?.shown && loaded.thinkingEnabled));
      else if (
        toggle === "off" ||
        (!toggle && loaded?.shown && loaded.thinkingEnabled)
      )
        this.sync.collapse(id);
      else if (!loaded?.shown || !loaded.thinkingEnabled)
        await this.sync.more(id, true);
    } else if (name === "copy") {
      const id = messageID(args[0]);
      this.sync.collapse(id);
      await this.sync.more(id, false);
      const loaded = this.sync.loaded.get(id);
      if (!loaded || (loaded.next && args[1] !== "loaded"))
        throw Error(
          "COPY_INCOMPLETE: use explicit loaded to copy this identified segment",
        );
      this.copy(loaded.text, false, generation);
      this.notice = `Copy ${id}${loaded.next ? " loaded segment only" : " complete body"}`;
    } else if (name === "pasteblock") {
      const target = this.store.editors[view],
        id = resolveID(
          args[0],
          target.draft.nodes.filter((n) => n.kind === "paste").map((n) => n.id),
        ),
        node = target.draft.nodes.find((n) => n.id === id)!;
      if (args[1] === "copy") this.copy(node.text, false, generation);
      else if (args[1] === "remove") {
        const start = flatten(
          target.draft.nodes.slice(0, target.draft.nodes.indexOf(node)),
        ).length;
        try {
          target.edit(start, start + node.text.length, "", "typed");
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "NON_UNDOABLE_CONFIRMATION_REQUIRED"
          )
            this.largeEdit = {
              editor: target,
              revision: target.draft.revision,
              sourceRevision: source.draft.revision,
              start,
              end: start + node.text.length,
              dismissCommand: !!this.command,
              view,
            };
          throw error;
        }
      } else {
        target.togglePaste(id, args[1] !== "collapse");
        if (args[1] === "edit") {
          const start = flatten(
            target.draft.nodes.slice(0, target.draft.nodes.indexOf(node)),
          ).length;
          target.select({ anchor: start, head: start + node.text.length });
        }
      }
      this.store.edited();
      clearSource = !!this.command;
    } else if (name === "outbox") {
      this.recordID = undefined;
      if (args[0]?.startsWith("receipts:")) {
        const page = await this.store.writer.receipts(args[0].slice(9));
        const records = await Promise.all(
          page.items.map(async (ref) =>
            JSON.parse(await this.store.writer.read(ref)),
          ),
        );
        this.panel =
          records
            .map(
              (r) =>
                `${r.sequence} ${r.receipt.request_id} received; receipt state ${r.receipt.state}`,
            )
            .join("\n") +
          (page.next
            ? `\nNext: /outbox receipts:${page.next}`
            : "\nEnd of receipt archive.");
      } else if (args[0] && !args[0].startsWith("page:")) {
        const id = resolveID(
            args[0],
            this.store.state.outbox.map((e) => e.request_id),
          ),
          entry = this.store.state.outbox.find((e) => e.request_id === id)!;
        this.recordID = id;
        this.panel = JSON.stringify(
          {
            ...entry,
            body: JSON.parse(await this.store.writer.read(entry.body)),
          },
          null,
          2,
        );
        this.notice =
          "Bounded body preview. Copy record copies the complete original text; unknown/conflict bodies cannot be restored or discarded.";
      } else {
        const page = args[0] ? Number(args[0].slice(5)) : 1;
        if (!Number.isSafeInteger(page) || page < 1 || page > 20)
          throw Error("INVALID_OUTBOX_PAGE");
        this.panel =
          this.store.state.outbox
            .slice((page - 1) * 50, page * 50)
            .map((e) => `${e.sequence} ${e.request_id} ${e.state}`)
            .join("\n") || "Outbox page empty.";
        this.panel += `\nPage ${page}; /outbox page:${page + 1} for next; /outbox <id> for details; /outbox receipts: for receipt archive.`;
      }
    } else if (name === "retry" || name === "discard") {
      if (!sameBinding(this.binding ?? null, this.store.state.binding))
        throw Error("FOREIGN_DOMAIN_QUARANTINED");
      const id = resolveID(
        args[0],
        this.store.state.outbox.map((e) => e.request_id),
      );
      if (name === "retry") await this.outbox.retry(id, generation);
      else await this.store.discard(id);
    }
    if (clearSource && source.draft.revision === revision) {
      if (this.command === source) this.command = undefined;
      else {
        this.store.editors[view] = new Editor({
          ...emptyDraft(),
          revision: revision + 1,
        });
        await this.store.save();
      }
    }
  }
  async close() {
    if (this.closing) return;
    this.closing = true;
    this.lifetime.abort();
    clearTimeout(this.publishTimer);
    this.outbox.close();
    this.sync.close();
    let saved = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      saved = await Promise.race([
        this.outbox
          .idle()
          .then(() => this.store.flush())
          .then(() => true)
          .catch(() => false),
        new Promise<boolean>(
          (resolve) => (deadline = setTimeout(() => resolve(false), 2000)),
        ),
      ]);
    } finally {
      clearTimeout(deadline);
      await this.browser.close();
      this.store.writer.child.stdin.end();
      this.onExit(saved);
    }
  }
}
