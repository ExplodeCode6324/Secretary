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
  taskEntry,
  safeText,
  type ViewEntry,
} from "./view.ts";
import { visibleItem } from "./history.ts";
import { copySelection } from "./clipboard.ts";

export class TerminalApp {
  readonly tui: TuiAltScreen;
  readonly editors: Record<Page, DraftEditor>;
  readonly documents = { Main: new DocumentView(), Task: new DocumentView() };
  readonly scrolls: Record<Page, AnchoredScroll>;
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
  private taskPages: (string | undefined)[] = [undefined];
  private pageIndex = 0;
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
      copySelection: clipboard,
    });
    this.editors = {
      Main: new DraftEditor(this.tui, () => "Main"),
      Task: new DraftEditor(this.tui, () => "Task"),
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
        this.draw();
      };
      editor.onExplicitSubmit = (raw, snapshot) => {
        this.clearHint();
        this.submit(raw, snapshot ?? editor.snapshot());
      };
    }
    this.tui.addInputListener((data) => {
      if (matchesKey(data, "ctrl+c")) {
        void this.close();
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
            if (
              this.page === "Task" &&
              this.remote &&
              (up
                ? scroll.scrollTop === 0 && this.pageIndex > 0
                : scroll.atEnd && !!this.remote.tasks.next_cursor)
            ) {
              void this.taskPage(up ? -1 : 1);
            } else {
              scroll.scrollBy(up ? -1 : 1);
              if (
                !up &&
                scroll.atEnd &&
                !(this.page === "Task" && this.remote?.tasks.next_cursor) &&
                !(this.page === "Main" && this.remote?.history.hasAfter)
              ) {
                this.viewing = false;
                this.tui.setFocus(editor);
              }
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
      void this.delivery?.reconcile().catch((e) => {
        this.uiHint = String(e);
        this.draw();
      });
    }, 3000);
  }
  private layout() {
    this.tui.setLayoutRoot(
      new VStack([
        { component: this.scrolls[this.page], basis: 0, grow: 1, minSize: 1 },
        {
          component: this.editors[this.page],
          basis: "auto",
          minSize: 3,
          maxSize: 10,
        },
        { component: this.footer, basis: 2, minSize: 1, maxSize: 2 },
      ]),
    );
    this.tui.setFocus(
      this.viewing ? this.scrolls[this.page] : this.editors[this.page],
    );
  }
  private clearHint() {
    this.uiHint = "";
    this.remote?.clearError();
    if (this.delivery && !this.delivery.failedSave) this.delivery.hint = "";
  }
  private submit(raw: string, snapshot: DraftSnapshot) {
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
    const action = parseDraft(snapshot, this.page);
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
    if (action.kind === "cot") {
      void this.remote?.toggleThinking().catch((e) => {
        this.uiHint = "CoT 显示切换失败：" + String(e);
        this.draw();
      });
    }
    if (action.kind === "help")
      this.uiHint =
        "/M /T /back /help · Main: /send <正文> /rawmessage <正文> /cotvisible /cotv · 查看时 ↑/↓ 连续读取历史";
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
  private async taskPage(delta: number) {
    if (!this.remote) return;
    this.pageLoading = true;
    try {
      const nextIndex = this.pageIndex + delta;
      const cursor =
        delta > 0 ? this.remote.tasks.next_cursor! : this.taskPages[nextIndex];
      if (await this.remote.page(cursor)) {
        this.taskPages[nextIndex] = cursor;
        this.pageIndex = nextIndex;
        this.remoteDirty = true;
        if (delta < 0) this.scrolls.Task.scrollToEnd();
        else this.scrolls.Task.scrollToStart();
      }
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
      this.documents.Task.entries = [
        {
          id: "task-title",
          version: String(this.pageIndex),
          component: new Text(
            `Task · 基础列表，创建顺序 · 第 ${this.pageIndex + 1} 页\n查看时 ↑/↓ 到边界翻页；Esc 返回输入；完整筛选/排序在 #83\n`,
            0,
            0,
          ),
        },
        ...(this.remote?.tasks.items ?? []).map((t) =>
          taskEntry(
            t,
            t.scope_id
              ? (this.remote?.scopes.get(t.scope_id) ?? t.scope_id)
              : "Shared",
          ),
        ),
        {
          id: "task-end",
          version: String(this.remote?.tasks.next_cursor),
          component: new Text(
            this.remote?.tasks.next_cursor
              ? "下页：查看模式滚动至底部后 ↓"
              : "本页结束",
            0,
            0,
          ),
        },
      ];
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
      this.remote?.error ||
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
