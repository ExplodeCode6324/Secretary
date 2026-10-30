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
import { DraftEditor, parseInput, configureKeys, type Page } from "./input.ts";
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
  private contentVersion = 0;
  private remoteDirty = true;
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
  ) {
    configureKeys();
    this.tui = new TuiAltScreen(terminal);
    this.editors = {
      Main: new DraftEditor(this.tui, () => "Main"),
      Task: new DraftEditor(this.tui, () => "Task"),
    };
    this.scrolls = {
      Main: new AnchoredScroll(this.documents.Main),
      Task: new AnchoredScroll(this.documents.Task),
    };
    for (const page of ["Main", "Task"] as const) {
      const editor = this.editors[page];
      editor.enabled = false;
      editor.onEdited = (raw) => {
        this.clearHint();
        this.delivery?.edit(page, raw);
        if (this.delivery)
          this.renderedDraft[page] =
            this.delivery.state.drafts[page].generation;
        this.draw();
      };
      editor.onOperation = () => {
        this.draw();
      };
      editor.onExplicitSubmit = (raw) => {
        this.clearHint();
        this.submit(raw);
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
                !(this.page === "Task" && this.remote?.tasks.next_cursor)
              ) {
                this.viewing = false;
                this.tui.setFocus(editor);
              }
            }
            this.draw();
            return { consume: true };
          }
          // Reading mode never sends or edits a hidden draft.
          if (!matchesKey(data, "pageUp") && !matchesKey(data, "pageDown"))
            return { consume: true };
        } else if (
          matchesKey(data, "up") &&
          !editor.isShowingAutocomplete() &&
          editor.onFirstVisualRow(this.tui.terminal.columns)
        ) {
          this.viewing = true;
          this.tui.setFocus(scroll);
          scroll.scrollBy(-1);
          this.draw();
          return { consume: true };
        }
      }
      if (this.page === "Task" && !this.pageLoading && this.remote) {
        const scroll = this.scrolls.Task;
        if (
          matchesKey(data, "pageDown") &&
          scroll.atEnd &&
          this.remote.tasks.next_cursor
        ) {
          void this.taskPage(1);
          return { consume: true };
        }
        if (
          matchesKey(data, "pageUp") &&
          scroll.scrollTop === 0 &&
          this.pageIndex > 0
        ) {
          void this.taskPage(-1);
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
    if (this.delivery && !this.delivery.failedSave) this.delivery.hint = "";
  }
  private submit(raw: string) {
    if (!this.delivery) return;
    const action = parseInput(raw, this.page);
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
      void this.delivery.submit(raw, action.text);
      return;
    }
    // Local commands consume only their own editor text, never issue business messages.
    const page = this.page;
    this.delivery.edit(page, "");
    this.editors[page].setText("");
    this.renderedDraft[page] = this.delivery.state.drafts[page].generation;
    void this.delivery.flush().catch(() => this.draw());
    if (action.kind === "navigate" && action.page !== this.page) {
      this.page = action.page;
      this.layout();
    }
    if (action.kind === "help")
      this.uiHint =
        "/M /T /back /help · Main: /send <正文> /rawmessage <正文> · 后续: CoT/历史(#91)、详情(#83)、事项(#92)、失败(#93)、图片/产物(#94)";
    this.draw();
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
      }
      await this.delivery.connect(client);
      if (this.stopped || this.stopping) return;
      const previous = this.remote;
      previous?.stop();
      this.remote = new RemoteViews(client);
      if (previous) this.remote.inherit(previous);
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
          this.editors[page].setText(d.raw);
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
            "Main · 近期消息（完整历史将在 #91 接入）\n",
            0,
            0,
          ),
        },
      ];
      if (this.remote) {
        for (const m of this.remote.messages.values()) {
          let entry = this.messageCache.get(m.id);
          const notice = this.remote.notices.get(m.id);
          if (
            !entry ||
            this.messageRefs.get(m.id) !== m ||
            this.messageNotices.get(m.id) !== notice
          ) {
            entry = {
              id: m.id,
              version: String(++this.contentVersion),
              component: timelineComponent(m, notice),
            };
            this.messageCache.set(m.id, entry);
            this.messageRefs.set(m.id, m);
            this.messageNotices.set(m.id, notice);
          }
          entries.push(entry);
        }
      }
      if (this.remote?.error)
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
    const persistentHint = pending
      ? `送达 ${pending.status} · ${pending.id.slice(0, 8)} · 原文：${Array.from(safeText(pending.raw).replace(/\s+/g, " ")).slice(0, 48).join("")}${Array.from(pending.raw).length > 48 ? "…" : ""}`
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
        `${this.page} · ${this.viewing ? "查看：↑/↓ 滚动 · ↓ 到底部或 Esc 返回输入" : this.page === "Main" ? "发送到 Main" : "普通草稿，不发送"} ${this.tui.terminal.rows < 8 ? "（窗口过小，请增高）" : ""}\n${hint}`,
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
