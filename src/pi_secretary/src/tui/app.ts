import { MatterController } from "./matter.ts";
import type { MasterAttentionItem } from "../api/contracts.ts";
import os from "node:os";
import path from "node:path";
import {
  ProcessTerminal,
  TuiAltScreen,
  VStack,
  Text,
  matchesKey,
  type Terminal,
} from "@earendil-works/pi-tui";
import { attachCore } from "../core-client.ts";
import { DraftEditor, parseDraft, configureKeys, type Page } from "./input.ts";
import {
  plainSnapshot,
  equalSnapshotContent,
  type DraftSnapshot,
} from "./draft.ts";
import { LocalFiles } from "./state.ts";
import { Delivery } from "./delivery.ts";
import { RemoteViews } from "./remote.ts";
import {
  DocumentView,
  AnchoredScroll,
  timelineComponent,
  safeText,
  visibleMatterText,
  type ViewEntry,
} from "./view.ts";
import { visibleItem } from "./history.ts";
import { copySelection } from "./clipboard.ts";

export class TerminalApp {
  readonly tui: TuiAltScreen;
  readonly editors: Record<Page, DraftEditor>;
  readonly documents = { Main: new DocumentView(), Task: new DocumentView() };
  readonly scrolls: Record<Page, AnchoredScroll>;
  readonly matters = new MatterController();
  readonly matterDocument = new DocumentView();
  readonly matterScroll = new AnchoredScroll(this.matterDocument);
  readonly matterEditor: DraftEditor;
  private matterFocus = "detail";
  private matterOrigin?: {
    page: Page;
    generation: number;
    snapshot: DraftSnapshot;
    viewing: boolean;
  };
  private layoutMode = "";
  private matterText = "";
  private attentionSelecting = false;
  readonly footer = new Text("连接 Core… Ctrl+C 退出", 0, 0);
  page: Page = "Main";
  viewing = false;
  delivery?: Delivery;
  remote?: RemoteViews;
  private files?: LocalFiles;
  private stopping = false;
  private stopped = false;
  private attaching = false;
  private retry?: ReturnType<typeof setTimeout>;
  private statusTimer?: ReturnType<typeof setInterval>;
  private pageLoading = false;
  private uiHint = "";
  private renderedDraft = { Main: -1, Task: -1 };
  private initialTimeline = true;
  private messageCache = new Map<string, ViewEntry>();
  private messageRefs = new Map<string, unknown>();
  private messageNotices = new Map<string, string | undefined>();
  private messageModes = new Map<string, boolean>();
  private contentVersion = 0;
  private remoteDirty = true;
  private navigationEpoch = 0;
  private followCandidate?: number;
  constructor(
    readonly coreDirectory: string,
    terminal: Terminal = new ProcessTerminal(),
    readonly stateRoot = path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Secretary",
      "tui",
      "v1",
    ),
    clipboard: (text: string) => Promise<boolean | string> = copySelection,
  ) {
    configureKeys();
    this.tui = new TuiAltScreen(terminal, undefined, undefined, {
      copySelection: (text) => {
        // Pi has captured the copied text. Release even when the pointer ended
        // outside the document; its lingering highlight must not freeze output.
        this.scrolls[this.page].endSelection();
        this.tui.requestRender();
        return clipboard(text);
      },
    });
    this.editors = {
      Main: new DraftEditor(this.tui, () => "Main"),
      Task: new DraftEditor(
        this.tui,
        () => "Task",
        (prefix) =>
          this.remote?.taskBrowser.suggest(prefix) ?? Promise.resolve([]),
        () => !!this.remote?.taskBrowser.selected,
      ),
    };
    this.matterEditor = new DraftEditor(
      this.tui,
      () => this.page,
      undefined,
      undefined,
      false,
    );
    this.matterEditor.onEdited = () => this.draw();
    this.matterEditor.onExplicitSubmit = (raw) => void this.matters.submit(raw);
    this.matters.onChange = () => {
      const current = this.matters.current;
      if (current && this.matterText !== current.text) {
        this.matterFocus = current.kind === "decision" ? "editor" : "detail";
        this.matterDocument.entries = [
          {
            id: current.id,
            version: current.version,
            component: new Text(safeText(current.text), 0, 0),
          },
        ];
        this.matterText = current.text;
        this.focusMatter();
      }
      this.draw();
    };
    this.matters.onExit = (origin, result, message) => {
      const saved = this.matterOrigin;
      this.page = origin;
      if (
        saved &&
        this.delivery?.state.drafts[origin].generation === saved.generation
      ) {
        this.editors[origin].restore(saved.snapshot, false);
        this.viewing = saved.viewing;
      }
      this.remote?.attention.exit();
      if (result !== "escape") {
        this.viewing = false;
        if (origin === "Task") {
          this.remote?.taskBrowser.back();
          void this.remote?.taskBrowser.refresh();
        }
      }
      this.uiHint = message;
      this.matterOrigin = undefined;
      this.matterText = "";
      this.matterEditor.setText("");
      this.remote?.attention.schedule();
      this.draw();
    };
    this.scrolls = {
      Main: new AnchoredScroll(this.documents.Main),
      Task: new AnchoredScroll(this.documents.Task),
    };
    this.scrolls.Main.onReading = () => this.stopFollowing();
    this.documents.Main.onPointerRead = () => this.stopFollowing();
    this.documents.Main.selectionActive = () =>
      this.page === "Main" && this.tui.hasActiveSelection();
    this.documents.Main.onViewport = (rows) => {
      this.remote?.history.setAnchor(
        this.scrolls.Main.following
          ? [...(this.remote?.history.items.keys() ?? [])].at(-1)
          : rows.find((row) => this.remote?.history.items.has(row.item_id))
              ?.item_id,
      );
      this.remote?.focus([...new Set(rows.map((row) => row.item_id))]);
    };
    this.documents.Task.selectionActive = () =>
      this.page === "Task" && this.tui.hasActiveSelection();
    this.documents.Task.onViewport = (rows) => {
      if (this.page === "Task") this.remote?.taskBrowser.viewport(rows);
    };
    for (const page of ["Main", "Task"] as const) {
      const editor = this.editors[page];
      editor.enabled = false;
      editor.onEdited = (raw, snapshot, changed) => {
        if (changed) this.clearHint();
        this.delivery?.edit(page, raw, snapshot);
        if (this.delivery)
          this.renderedDraft[page] =
            this.delivery.state.drafts[page].generation;
        this.draw();
      };
      editor.onOperation = () => {
        if (this.page === "Task") this.remote?.taskBrowser.clearError();
        this.draw();
      };
      editor.onExplicitSubmit = (raw, snapshot) => {
        this.clearHint();
        this.submit(raw, snapshot ?? editor.snapshot());
      };
    }
    this.tui.addInputListener((data) => {
      this.scrolls[this.page].endSelection();
      if (matchesKey(data, "ctrl+c")) {
        void this.close();
        return { consume: true };
      }
      if (this.matters.current || this.matters.loading)
        return this.matterInput(data);
      if (this.page === "Main" && this.remote?.attention.selected) {
        if (matchesKey(data, "escape")) {
          this.remote.attention.exit();
          this.tui.setFocus(this.editors.Main);
          this.draw();
        } else if (matchesKey(data, "enter")) {
          const row = this.remote.attention.row;
          if (row) void this.openMatter(row.id, row);
        } else if (matchesKey(data, "up") || matchesKey(data, "down")) {
          void this.remote.attention
            .move(matchesKey(data, "up") ? -1 : 1)
            .then((edge) => {
              if (edge === "history") {
                this.viewing = true;
                this.tui.setFocus(this.scrolls.Main);
                this.scrolls.Main.scrollBy(-1);
              }
              if (edge === "editor") {
                this.viewing = false;
                this.tui.setFocus(this.editors.Main);
              }
              this.draw();
            });
        }
        return { consume: true };
      }
      const editor = this.editors[this.page],
        scroll = this.scrolls[this.page];
      if (!this.stopping && editor.enabled) {
        if (this.viewing) {
          if (matchesKey(data, "escape")) {
            this.viewing = false;
            this.tui.setFocus(editor);
            this.draw();
            return { consume: true };
          }
          if (matchesKey(data, "up") || matchesKey(data, "down")) {
            const up = matchesKey(data, "up");
            if (this.pageLoading) return { consume: true };
            this.clearHint();
            if (this.page === "Main" && this.remote) {
              const anchor = this.documents.Main.anchor;
              const edge =
                !up && scroll.atEnd
                  ? Array.from({ length: scroll.viewportHeight }, (_, index) =>
                      this.documents.Main.rowAt(scroll.scrollTop + index),
                    ).find((row) => row?.boundary === "after")
                  : undefined;
              if (edge) {
                void this.mainPage(
                  "after",
                  edge.item_id,
                  edge.region === "thinking" ? "thinking" : "body",
                );
                return { consume: true };
              }
              if (
                anchor &&
                (this.remote.history.evictedBodies.has(anchor.item_id) ||
                  anchor.boundary === (up ? "before" : "after") ||
                  this.remote.notices
                    .get(anchor.item_id)
                    ?.startsWith("正文读取失败"))
              ) {
                void this.mainPage(
                  up ? "before" : "after",
                  anchor.item_id,
                  anchor.region === "thinking" ? "thinking" : "body",
                );
                return { consume: true };
              }
              if (
                (up && scroll.scrollTop === 0) ||
                (!up && scroll.atEnd && this.remote.history.hasAfter) ||
                this.remote.history.unavailable
              ) {
                void this.mainPage(up ? "before" : "after");
                return { consume: true };
              }
            }
            if (this.page === "Task" && this.remote) {
              const task = this.remote.taskBrowser,
                anchor = this.documents.Task.anchor;
              const rows = Array.from(
                { length: scroll.viewportHeight },
                (_, i) => this.documents.Task.rowAt(scroll.scrollTop + i),
              );
              const edge =
                anchor?.item_id.startsWith("page:") &&
                anchor.item_id.endsWith(up ? ":before" : ":after")
                  ? anchor
                  : !up && scroll.atEnd
                    ? rows.find(
                        (r) =>
                          r?.item_id.startsWith("page:") &&
                          r.item_id.endsWith(":after"),
                      )
                    : undefined;
              const bodyEdge =
                anchor?.boundary === (up ? "before" : "after")
                  ? anchor
                  : !up && scroll.atEnd
                    ? rows.find((r) => r?.boundary === "after")
                    : undefined;
              if (
                edge ||
                bodyEdge ||
                (anchor && task.notices.has(anchor.item_id))
              ) {
                const row = edge ?? bodyEdge ?? anchor!;
                void this.taskPage(
                  up ? "before" : "after",
                  row.item_id,
                  row.region === "thinking" ? "thinking" : "body",
                );
                return { consume: true };
              }
              if (
                (up && scroll.scrollTop === 0 && task.hasBefore) ||
                (!up && scroll.atEnd && task.hasAfter)
              ) {
                void this.taskPage(up ? "before" : "after");
                return { consume: true };
              }
            }
            scroll.scrollBy(up ? -1 : 1);
            if (
              !up &&
              scroll.atEnd &&
              !(this.page === "Main" && this.remote?.history.hasAfter) &&
              !(this.page === "Task" && this.remote?.taskBrowser.hasAfter)
            ) {
              this.viewing = false;
              if (this.page === "Main" && this.remote?.attention.enter())
                this.tui.setFocus(null);
              else this.tui.setFocus(editor);
            }
            this.draw();
            return { consume: true };
          }
          // Resume editing at the preserved cursor; never swallow typing/paste.
          this.viewing = false;
          this.tui.setFocus(editor);
          this.draw();
          if (
            matchesKey(data, "enter") ||
            matchesKey(data, "shift+enter") ||
            data === "\n"
          )
            return { consume: true };
          // Other input is dispatched once to the newly focused editor by TUI.
        } else if (
          matchesKey(data, "up") &&
          !editor.isShowingAutocomplete() &&
          editor.onFirstVisualRow(this.tui.terminal.columns)
        ) {
          if (this.page === "Main" && this.remote?.attention.enter()) {
            this.stopFollowing();
            this.tui.setFocus(null);
            this.draw();
            return { consume: true };
          }
          this.viewing = true;
          this.tui.setFocus(scroll);
          scroll.scrollBy(-1);
          this.clearHint();
          if (
            this.page === "Main" &&
            scroll.scrollTop === 0 &&
            this.remote?.history.hasBefore
          )
            void this.mainPage("before");
          this.draw();
          return { consume: true };
        }
      }
    });
    this.layout();
  }
  start() {
    this.tui.start();
    void this.attach();
    this.statusTimer = setInterval(() => {
      void this.matters.refresh();
      void this.delivery?.reconcile().catch((e) => {
        this.uiHint = String(e);
        this.draw();
      });
    }, 3000);
  }
  private matterInput(data: string) {
    const current = this.matters.current;
    if (matchesKey(data, "escape")) {
      this.matters.exit();
      return { consume: true };
    }
    if (!current) return { consume: true };
    const focuses =
      current.kind === "authorization"
        ? ["detail", "approve", "reject"]
        : current.kind === "decision"
          ? [
              "editor",
              "detail",
              ...current.options.map((_, i) => "option:" + i),
            ]
          : ["detail"];
    if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
      const direction = matchesKey(data, "shift+tab") ? -1 : 1;
      this.matterFocus =
        focuses[
          (focuses.indexOf(this.matterFocus) + direction + focuses.length) %
            focuses.length
        ];
      this.focusMatter();
      this.draw();
      return { consume: true };
    }
    if (matchesKey(data, "shift+enter")) {
      if (current.kind === "decision" && this.matterFocus === "editor")
        void this.matters.submit(this.matterEditor.getExpandedText());
      else if (current.kind === "authorization")
        void this.matters.submit(
          "",
          this.matterFocus === "approve"
            ? "APPROVE"
            : this.matterFocus === "reject"
              ? "REJECT"
              : undefined,
        );
      return { consume: true };
    }
    if (
      this.matterFocus.startsWith("option:") &&
      (matchesKey(data, "up") || matchesKey(data, "down"))
    ) {
      const index = Number(this.matterFocus.split(":")[1]);
      this.matterFocus =
        "option:" +
        Math.max(
          0,
          Math.min(
            current.options.length - 1,
            index + (matchesKey(data, "up") ? -1 : 1),
          ),
        );
      this.draw();
      return { consume: true };
    }
    if (this.matterFocus.startsWith("option:") && matchesKey(data, "enter")) {
      this.matterEditor.setText(
        current.options[Number(this.matterFocus.split(":")[1])],
      );
      this.matterFocus = "editor";
      this.focusMatter();
      this.draw();
      return { consume: true };
    }
    if (this.matterFocus !== "editor") {
      if (this.matterFocus === "detail") {
        if (matchesKey(data, "up")) this.matterScroll.scrollBy(-1);
        if (matchesKey(data, "down")) this.matterScroll.scrollBy(1);
        if (matchesKey(data, "pageUp"))
          this.matterScroll.scrollBy(
            -Math.max(1, this.matterScroll.viewportHeight - 1),
          );
        if (matchesKey(data, "pageDown"))
          this.matterScroll.scrollBy(
            Math.max(1, this.matterScroll.viewportHeight - 1),
          );
      }
      this.draw();
      return { consume: true };
    }
    // Literal input, including all slash commands, goes only to the temporary editor.
    return undefined;
  }
  private focusMatter() {
    this.tui.setFocus(
      this.matterFocus === "editor" ? this.matterEditor : this.matterScroll,
    );
  }
  private async openMatter(id: string, row?: MasterAttentionItem) {
    this.stopFollowing();
    const draft = this.delivery!.state.drafts[this.page];
    this.matterOrigin = {
      page: this.page,
      generation: draft.generation,
      snapshot: this.editors[this.page].snapshot(),
      viewing: this.viewing,
    };
    this.matterEditor.setText("");
    this.matterText = "";
    this.viewing = false;
    await this.matters.open(id, this.page, row);
    if (this.matters.current?.id === id && row)
      this.remote?.attention.seen.add(row.key);
    this.draw();
  }
  private layout() {
    const active = !!this.matters.current || this.matters.loading;
    const attention = this.page === "Main" ? this.remote?.attention : undefined;
    const pane =
      attention && (!!attention.head?.counts.total || !!attention.error);
    this.layoutMode = `${active}:${this.page}:${!!pane}`;
    this.tui.setLayoutRoot(
      new VStack([
        {
          component: active ? this.matterScroll : this.scrolls[this.page],
          basis: 0,
          grow: 1,
          minSize: 1,
        },
        ...(pane
          ? [
              {
                component: attention,
                basis: "auto" as const,
                minSize: 1,
                maxSize: 8,
              },
            ]
          : []),
        {
          component: active ? this.matterEditor : this.editors[this.page],
          basis: "auto",
          minSize: 3,
          maxSize: 10,
        },
        { component: this.footer, basis: 2, minSize: 1, maxSize: 2 },
      ]),
    );
    if (active) this.focusMatter();
    else
      this.tui.setFocus(
        attention?.selected
          ? null
          : this.viewing
            ? this.scrolls[this.page]
            : this.editors[this.page],
      );
  }
  private clearHint() {
    this.uiHint = "";
    this.matters.hint = "";
    this.remote?.clearError();
    if (this.delivery && !this.delivery.failedSave) this.delivery.hint = "";
  }
  private submit(raw: string, snapshot: DraftSnapshot) {
    if (this.matters.current || this.matters.loading) {
      void this.matters.submit(raw);
      return;
    }
    if (!this.delivery) return;
    const pending = this.delivery.state.pending,
      draft = this.delivery.state.drafts.Main;
    if (
      this.page === "Main" &&
      pending &&
      draft.binding === pending.id &&
      raw === pending.raw &&
      equalSnapshotContent(
        snapshot,
        pending.snapshot ?? plainSnapshot(pending.raw),
      )
    ) {
      this.submitMessage(pending.raw, pending.body.text, pending.snapshot);
      return;
    }
    const action = parseDraft(
      snapshot,
      this.page,
      !!this.remote?.taskBrowser.selected,
    );
    if (action.kind === "error") {
      this.uiHint = action.message;
      this.draw();
      return;
    }
    if (action.kind === "draft") {
      this.uiHint = "Task 草稿已保留；不会发送给 Main 或执行 Agent";
      this.draw();
      return;
    }
    if (action.kind === "send") {
      this.submitMessage(raw, action.text, snapshot);
      return;
    }
    // Local commands consume only their own editor text, never issue business messages.
    const page = this.page;
    this.delivery.edit(page, "");
    this.editors[page].setText("");
    this.renderedDraft[page] = this.delivery.state.drafts[page].generation;
    void this.delivery.flush().catch(() => this.draw());
    if (action.kind === "navigate" && action.page !== this.page) {
      this.stopFollowing();
      this.page = action.page;
      this.layout();
    }
    if (action.kind === "back" && this.page === "Task")
      this.remote?.taskBrowser.back();
    if (action.kind === "search_task")
      void this.remote?.taskBrowser.search(action.id);
    if (action.kind === "show") void this.openMatter(action.id);
    if (action.kind === "taskdetail")
      void this.remote?.taskBrowser.open(action.id);
    if (action.kind === "cot") {
      void this.remote?.toggleThinking().catch((e) => {
        this.uiHint = "CoT 显示切换失败：" + String(e);
        this.draw();
      });
    }
    if (action.kind === "help")
      this.uiHint =
        "/m /t /back /help · Main: /send <正文> /rawmessage <正文> /cotvisible /cotv · Task: /search_task <ID> /taskdetail <完整ID> /show <事项完整ID> · ↑/↓ 连续读取";
    this.draw();
  }
  private submitMessage(raw: string, text: string, snapshot?: DraftSnapshot) {
    // A Task switch while the durable save is pending must win over a late POST.
    if (!this.delivery?.busy) this.followCandidate = this.navigationEpoch;
    void this.delivery?.submit(raw, text, snapshot);
  }
  private stopFollowing() {
    this.navigationEpoch++;
    this.followCandidate = undefined;
    this.scrolls.Main.following = false;
    this.remote?.setFollowing(false);
    this.remote?.history.cancelLatest();
  }
  private startFollowing() {
    if (this.followCandidate !== this.navigationEpoch || this.page !== "Main")
      return;
    this.followCandidate = undefined;
    this.scrolls.Main.following = true;
    this.remote?.setFollowing(true);
    void this.remote?.history.jumpToLatest();
    this.draw();
  }
  private async mainPage(
    direction: "before" | "after",
    id?: string,
    region?: "body" | "thinking",
  ) {
    if (!this.remote || this.pageLoading) return;
    this.pageLoading = true;
    try {
      if (id) await this.remote.loadBody(id, region, direction);
      else await this.remote.historyPage(direction);
      this.documents.Main.navigationDelta = direction === "before" ? -1 : 1;
      this.remoteDirty = true;
    } finally {
      this.pageLoading = false;
      this.draw();
    }
  }
  private async taskPage(
    direction: "before" | "after",
    marker?: string,
    region?: "body" | "thinking",
  ) {
    if (!this.remote || this.pageLoading) return;
    this.pageLoading = true;
    try {
      const browser = this.remote.taskBrowser;
      if (marker && browser.message(marker))
        await browser.loadBody(marker, region, direction);
      else await browser.page(direction, marker);
      this.documents.Task.navigationDelta = direction === "before" ? -1 : 1;
      this.remoteDirty = true;
    } finally {
      this.pageLoading = false;
      this.draw();
    }
  }
  private async attach() {
    if (this.attaching || this.stopped || this.stopping) return;
    this.attaching = true;
    try {
      const client = await attachCore(this.coreDirectory);
      if (!client) throw Error("Core 未运行/暂不可用；请单独启动 Core");
      const core = await client.core();
      if (this.stopped || this.stopping) return;
      if (
        !/^[a-zA-Z0-9_-]+$/.test(core.data_domain_id) ||
        !/^[a-zA-Z0-9_-]+$/.test(core.mode)
      )
        throw Error("INVALID_CORE_IDENTITY");
      if (!this.delivery) {
        const dir = path.join(this.stateRoot, core.data_domain_id, core.mode);
        this.files = new LocalFiles(dir);
        const state = await this.files.open(core.data_domain_id, core.mode);
        if (this.stopped || this.stopping) {
          await this.files.close();
          return;
        }
        this.delivery = new Delivery(state, this.files);
        this.delivery.onChange = () => this.draw();
        this.delivery.onEvent = (event) => {
          if (event.type === "post-start") this.startFollowing();
          if (event.type === "rejected") this.stopFollowing();
          if (event.type === "accepted")
            this.editors.Main.bridge.clearHistory();
        };
      }
      await this.delivery.connect(client);
      if (this.stopped || this.stopping) return;
      const previous = this.remote;
      previous?.stop();
      this.remote = new RemoteViews(client);
      if (previous) this.remote.inherit(previous);
      this.remote.setFollowing(this.scrolls.Main.following);
      this.remote.attention.height = () =>
        Math.min(8, Math.max(3, Math.floor(this.tui.terminal.rows / 4)));
      this.matters.connect(
        {
          query: this.remote.query.bind(this.remote),
          command: client.command.bind(client),
        },
        core.data_domain_id + ":" + core.mode,
      );
      this.remote.attention.onRefresh = () => void this.matters.refresh();
      this.remote.onChange = () => {
        this.remoteDirty = true;
        this.draw();
      };
      this.remote.onDisconnect = (e) => {
        this.uiHint = "连接中断，保留草稿/阅读位置：" + String(e);
        this.remote?.stop();
        this.draw();
        this.retry = setTimeout(() => void this.attach(), 1000);
      };
      // Restore disk snapshots synchronously before input can overwrite them.
      // Initial sync/history reads may be slow; they are not a draft-ready gate.
      this.draw();
      this.editors.Main.enabled = this.editors.Task.enabled = true;
      this.uiHint = "";
      // Independent reads: status latency must not hold initial editing or rendering.
      void this.delivery.reconcile(true).catch((e) => {
        this.uiHint = String(e);
        this.draw();
      });
      await this.remote.start();
      void this.files?.collect(this.delivery.state).catch(() => {});
    } catch (e) {
      this.uiHint = String(e);
      this.retry = setTimeout(() => void this.attach(), 2000);
    } finally {
      this.attaching = false;
      this.draw();
    }
  }
  draw() {
    if (this.stopped) return;
    if (this.delivery) {
      for (const page of ["Main", "Task"] as const) {
        const d = this.delivery.state.drafts[page];
        if (this.renderedDraft[page] !== d.generation) {
          this.editors[page].restore(
            d.snapshot ?? plainSnapshot(d.raw),
            !(
              page === "Main" &&
              !d.raw &&
              this.delivery.state.pending?.status === "UNKNOWN"
            ),
          );
          this.renderedDraft[page] = d.generation;
        }
      }
    }
    if (this.initialTimeline && this.remote?.timelineReady) {
      this.documents.Main.initialEnd = true;
      this.initialTimeline = false;
    }
    if (this.remoteDirty) {
      this.remoteDirty = false;
      const entries: ViewEntry[] = [
        {
          id: "main-title",
          version: "1",
          component: new Text(
            "Main · ↑/↓ 连续读取历史 · /cotv 切换思考显示\n",
            0,
            0,
          ),
        },
      ];
      if (this.remote) {
        for (const id of this.messageCache.keys())
          if (!this.remote.history.items.has(id)) {
            this.messageCache.delete(id);
            this.messageRefs.delete(id);
            this.messageNotices.delete(id);
            this.messageModes.delete(id);
          }
        if (this.remote.error && this.remote.history.errorSide === "before")
          entries.push({
            id: "load-error-before",
            version: this.remote.error,
            component: new Text(safeText(this.remote.error), 0, 0),
          });
        for (const m of this.remote.messages.values()) {
          if (!visibleItem(m)) continue;
          let entry = this.messageCache.get(m.id);
          const notice = this.remote.notices.get(m.id);
          if (
            !entry ||
            this.messageRefs.get(m.id) !== m ||
            this.messageModes.get(m.id) !== this.remote.history.thinking ||
            this.messageNotices.get(m.id) !== notice
          ) {
            entry = {
              id: m.id,
              version: String(++this.contentVersion),
              component: timelineComponent(
                m,
                notice,
                this.remote.history.thinking,
                this.remote.bodies.get(m.id),
                this.remote.history.evictedBodies.has(m.id),
              ),
              revision: m.revision,
              instance_id: this.remote.client.endpoint.instance_id,
              timeline_generation: this.remote.history.generation,
            };
            this.messageCache.set(m.id, entry);
            this.messageRefs.set(m.id, m);
            this.messageNotices.set(m.id, notice);
            this.messageModes.set(m.id, this.remote.history.thinking);
          }
          entries.push(entry);
        }
      }
      if (this.remote?.error && this.remote.history.errorSide === "after")
        entries.push({
          id: "load-error",
          version: this.remote.error,
          component: new Text(safeText(this.remote.error), 0, 0),
        });
      this.documents.Main.entries = entries;
      this.documents.Task.entries = this.remote?.taskBrowser.entries() ?? [];
      const taskRestore = this.remote?.taskBrowser.restoreAnchor;
      if (taskRestore) {
        this.documents.Task.restoreAnchor(taskRestore);
        this.remote!.taskBrowser.restoreAnchor = undefined;
      }
    }
    const active = !!this.matters.current || this.matters.loading;
    const attention = this.page === "Main" ? this.remote?.attention : undefined;
    const pane =
      !!attention && (!!attention.head?.counts.total || !!attention.error);
    if (
      this.attentionSelecting &&
      !attention?.selected &&
      !active &&
      !this.viewing
    )
      this.tui.setFocus(this.editors[this.page]);
    this.attentionSelecting = !!attention?.selected;
    if (this.layoutMode !== `${active}:${this.page}:${pane}`) this.layout();
    if (active) {
      const current = this.matters.current;
      this.matterEditor.enabled = current?.kind === "decision";
      const focus =
        this.matterFocus === "approve"
          ? "[批准] 拒绝"
          : this.matterFocus === "reject"
            ? "批准 [拒绝]"
            : this.matterFocus.startsWith("option:")
              ? `选项 ${Number(this.matterFocus.split(":")[1]) + 1}：${current?.options[Number(this.matterFocus.split(":")[1])]}`
              : this.matterFocus === "editor"
                ? "回答输入"
                : "详情滚动";
      this.footer.setText(
        visibleMatterText(
          `事项 ${current?.id ?? "读取中"} · ${focus} · Tab 切换 · Esc 返回\n${this.matters.hint || (current?.kind === "decision" ? "Enter 换行 · Shift+Enter 字面回答；命令不可用" : current?.kind === "authorization" ? "Enter 不执行 · Shift+Enter 确认所选动作" : "只读详情 · ↑/↓/PageUp/PageDown")} `,
        ),
      );
      this.tui.requestRender();
      return;
    }
    const pending = this.delivery?.state.pending;
    const recovery = this.delivery?.state.recovery;
    const preview = Array.from(
      safeText(pending?.raw ?? "").replace(/\s+/g, " "),
    );
    const persistentHint = pending
      ? `送达 ${pending.status} · ${pending.id.slice(0, 8)} · 原文：${preview.slice(0, 48).join("")}${preview.length > 48 ? "…" : ""}`
      : recovery
        ? `恢复原文：${this.files ? path.join(this.files.directory, recovery.file) : recovery.file} · /help`
        : "";
    const hint =
      this.uiHint ||
      this.delivery?.hint ||
      this.matters.hint ||
      (attention?.selected
        ? "↑/↓ 选择事项 · Enter 打开 · Esc 返回编辑器"
        : attention?.error) ||
      (this.page === "Task"
        ? this.remote?.taskBrowser.error || this.remote?.taskBrowser.notice
        : this.remote?.error) ||
      persistentHint ||
      "/help · Enter 换行 · Shift+Enter 提交 · 第一行 ↑ 查看 · Ctrl+C 退出";
    this.footer.setText(
      safeText(
        `${this.page} · ${this.viewing ? "查看：↑/↓ 滚动 · 输入/粘贴或 Esc 返回" : this.page === "Main" ? "发送到 Main" : "普通草稿，不发送"} ${this.tui.terminal.rows < 8 ? "（窗口过小，请增高）" : ""}\n${hint}`,
      ),
    );
    this.tui.requestRender();
  }
  async close() {
    if (this.stopping || this.stopped) return;
    this.stopping = true;
    this.editors.Main.enabled = this.editors.Task.enabled = false;
    try {
      await this.delivery?.close();
      this.stopped = true;
      clearTimeout(this.retry);
      clearInterval(this.statusTimer);
      this.remote?.stop();
      this.matters.stop();
      await this.files?.close();
      this.tui.stop();
    } catch (e) {
      this.editors.Main.enabled = this.editors.Task.enabled = !!this.delivery;
      this.uiHint = "保存失败，暂不退出：" + String(e);
      this.draw();
    } finally {
      this.stopping = false;
    }
  }
}
