import { TimelineWindow } from "./timeline-window.js";
import { renderMarkdown } from "./markdown.js";
import { ActivityView } from "./activity.js";
const el = (tag, text, className) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  if (className) n.className = className;
  return n;
};
export class TimelineView {
  constructor({
    scroller,
    root,
    footer,
    request,
    preferences,
    action,
    changed,
  }) {
    Object.assign(this, {
      scroller,
      root,
      footer,
      request,
      preferences,
      action,
      changed,
    });
    this.controller = new AbortController();
    this.cache = new TimelineWindow();
    this.nodes = new Map();
    this.heights = new Map();
    this.pending = new Map();
    this.fragments = new Set();
    this.generation = 0;
    this.follow = true;
    this.revision = null;
    this.top = el("div", null, "timeline-spacer");
    this.bottom = el("div", null, "timeline-spacer");
    this.older = el("button", "加载更早记录", "timeline-page");
    this.newer = el("button", "加载较新记录", "timeline-page");
    this.notice = el("div", "正在加载历史…", "activity-history-note");
    this.latest = el("button", "回到最新消息", "timeline-latest");
    this.older.onclick = () => this.load("before");
    this.newer.onclick = () => this.load("after");
    this.latest.onclick = () => this.open();
    scroller.insertBefore(this.notice, root);
    scroller.insertBefore(this.older, root);
    scroller.append(this.newer);
    footer.append(this.latest);
    this.connection = el("div", "正在连接活动状态", "activity-connection");
    this.queue = el("div", "", "activity-queue");
    this.locators = el("div", "", "activity-locators");
    footer.append(this.connection, this.queue, this.locators);
    root.replaceChildren(this.top, this.bottom);
    this.lastScrollTop = scroller.scrollTop;
    this.onScroll = () => {
      // Resizing can clamp scrollTop before ResizeObserver runs. Let render
      // restore the existing follow/anchor instead of treating that as input.
      if (
        scroller.clientWidth !== this.viewportWidth ||
        scroller.clientHeight !== this.viewportHeight ||
        scroller.scrollHeight !== this.contentHeight
      ) {
        this.schedule();
        return;
      }
      const top = scroller.scrollTop;
      // Scroll events arrive asynchronously. Render records its final position,
      // so its own corrections cannot re-enable follow or swallow a user gesture.
      if (top === this.lastScrollTop) return;
      if (top < this.lastScrollTop) this.follow = false;
      else if (!this.cache.after && this.atBottom()) this.follow = true;
      this.lastScrollTop = top;
      this.anchor = this.capture();
      this.schedule();
    };
    scroller.addEventListener("scroll", this.onScroll, { passive: true });
    this.observer = new ResizeObserver((entries) => {
      let modified = false;
      for (const entry of entries) {
        const id = entry.target.dataset.timelineId;
        if (!id) continue;
        const h = entry.target.getBoundingClientRect().height;
        if (Math.abs((this.heights.get(id) ?? 0) - h) > 0.5) {
          this.heights.set(id, h);
          modified = true;
        }
      }
      if (modified) this.schedule();
    });
    this.viewportObserver = new ResizeObserver(() => this.schedule());
    this.viewportObserver.observe(scroller);
    this.onSelection = () => this.schedule();
    document.addEventListener("selectionchange", this.onSelection);
    this.timer = setInterval(() => {
      this.updateTimes();
      if (Date.now() >= (this.nextSync ?? 0)) void this.sync();
    }, 700);
  }
  atBottom(tolerance = 2) {
    return (
      this.scroller.scrollHeight -
        this.scroller.clientHeight -
        this.scroller.scrollTop <
      tolerance
    );
  }
  capture() {
    const edge = this.scroller.getBoundingClientRect().top;
    for (const n of this.root.children)
      if (
        n.dataset.timelineId &&
        n.getBoundingClientRect().bottom > edge &&
        n.getBoundingClientRect().top < edge + this.scroller.clientHeight
      )
        return {
          id: n.dataset.timelineId,
          offset: n.getBoundingClientRect().top - edge,
        };
    return null;
  }
  protectedIDs() {
    const ids = new Set();
    const protect = (n) => {
      const row =
        n?.nodeType === 3
          ? n.parentElement?.closest("[data-timeline-id]")
          : n?.closest?.("[data-timeline-id]");
      if (row) ids.add(row.dataset.timelineId);
    };
    const focused = document.activeElement;
    if (
      focused &&
      focused.getBoundingClientRect().bottom >=
        this.scroller.getBoundingClientRect().top &&
      focused.getBoundingClientRect().top <=
        this.scroller.getBoundingClientRect().bottom
    )
      protect(focused);
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      protect(selection.anchorNode);
      protect(selection.focusNode);
    }
    for (const [id, node] of this.nodes)
      if (
        node.querySelector("details[open]") &&
        Date.now() - (node.interactedAt ?? 0) < 60000
      )
        ids.add(id);
    if (this.anchor) ids.add(this.anchor.id);
    return ids;
  }
  options(extra = {}) {
    return {
      thinking: this.preferences.thinking,
      streaming: this.preferences.streaming,
      ...extra,
    };
  }
  async ask(options) {
    return this.request(this.options(options), this.controller.signal);
  }
  summary(s) {
    this.connection.textContent = "";
    this.observedAt = Date.parse(s.observed_at);
    this.queue.textContent = [
      s.queue.accepted ? `待处理消息 ${s.queue.accepted} 条` : "",
      s.queue.claimed ? `已领取 ${s.queue.claimed} 条` : "",
      s.active ? `${s.active} 项当前或待处理活动` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const signature = JSON.stringify(s.locators);
    if (this.locatorSignature !== signature) {
      this.locatorSignature = signature;
      this.locators.replaceChildren();
      for (const l of s.locators) {
        const button = el("button", l.label);
        button.onclick = () => this.open(l.id);
        this.locators.append(button);
      }
    }
    this.changed?.(s);
  }
  async open(locate, preserve = false) {
    const anchor = preserve ? this.capture() : null;
    this.controller.abort();
    this.controller = new AbortController();
    const generation = ++this.generation;
    this.pending.clear();
    this.fragments.clear();
    this.syncing = false;
    this.revision = null;
    this.nextSync = 0;
    try {
      const page = await this.ask({ locate });
      if (generation !== this.generation) return;
      for (const n of this.nodes.values()) {
        this.observer.unobserve(n);
        n.remove();
      }
      this.nodes.clear();
      this.cache.reset();
      this.cache.apply(page, "after", new Set(), true);
      this.paused = false;
      this.older.disabled = this.newer.disabled = false;
      this.serverGeneration = page.generation;
      this.revision = page.revision;
      this.summary(page.summary);
      this.follow = !locate;
      this.anchor = anchor;
      this.heights.clear();
      this.render();
      if (locate && !preserve) {
        const i = this.cache.items.findIndex((m) => m.id === locate);
        this.scroller.scrollTop =
          this.root.offsetTop -
          this.scroller.offsetTop +
          this.cache.items
            .slice(0, i)
            .reduce((n, m) => n + (this.heights.get(m.id) ?? 100), 0);
        this.anchor = { id: locate, offset: 24 };
        this.render();
        this.nodes.get(locate)?.focus({ preventScroll: true });
      }
      this.notice.textContent = "历史按需加载；浏览器查找仅覆盖当前渲染范围";
    } catch (e) {
      if (generation === this.generation) {
        if (locate && e.message.includes("TIMELINE_ITEM_NOT_FOUND")) {
          await this.open();
          this.notice.textContent = "原位置未保存，已恢复到最新历史";
          return;
        }
        this.connection.textContent = "历史加载失败：" + e.message;
        this.notice.replaceChildren(el("span", "历史加载失败 "));
        const retry = el("button", "重试");
        retry.onclick = () => this.open(locate, preserve);
        this.notice.append(retry);
      }
    }
  }
  async load(direction) {
    const cursor = this.cache[direction];
    if (!cursor || this.pending.has(direction) || this.revision == null) return;
    const generation = this.generation,
      request = Symbol();
    this.pending.set(direction, request);
    const button = direction === "before" ? this.older : this.newer;
    button.disabled = true;
    button.textContent = "正在加载…";
    try {
      const page = await this.ask({ cursor, direction });
      if (generation !== this.generation) return;
      const anchor = this.capture();
      if (!this.cache.apply(page, direction, this.protectedIDs())) {
        this.paused = true;
        this.notice.textContent =
          "已达缓存预算；请结束文字选择或关闭正在查看的详情后重试";
        return;
      }
      this.anchor = anchor;
      this.summary(page.summary);
      this.render();
      this.paused = false;
      button.textContent =
        direction === "before" ? "加载更早记录" : "加载较新记录";
    } catch (e) {
      if (generation === this.generation) {
        this.paused = true;
        button.textContent = "加载失败，点击重试";
        if (e.message.includes("TIMELINE_RESET_REQUIRED"))
          await this.open(this.capture()?.id, true);
      }
    } finally {
      if (this.pending.get(direction) === request) {
        this.pending.delete(direction);
        button.disabled = false;
      }
    }
  }
  async sync() {
    if (
      this.revision == null ||
      this.syncing ||
      this.pending.size ||
      !navigator.onLine
    )
      return;
    const generation = this.generation;
    this.syncing = true;
    try {
      const page = await this.ask({
        since: this.revision,
        generation: this.serverGeneration,
        lower: this.cache.items[0]?.cursor,
        upper: this.cache.items.at(-1)?.cursor,
        tail: this.follow && !this.cache.after,
      });
      if (generation !== this.generation) return;
      if (page.reset) {
        await this.open(
          this.follow ? undefined : this.capture()?.id,
          !this.follow,
        );
        return;
      }
      this.summary(page.summary);
      if (this.cache.before && page.edges?.before)
        this.cache.before = page.edges.before;
      if (this.cache.after && page.edges?.after)
        this.cache.after = page.edges.after;
      if (page.outside) {
        this.latest.hidden = false;
        this.latest.textContent = "有新记录 · 回到最新";
      }
      if (page.items.length) {
        const anchor = this.capture();
        // State deltas do not change the current paging boundaries or make an evicted tail current.
        const before = this.cache.before,
          after = this.cache.after;
        if (
          !this.cache.apply(
            { ...page, before, after },
            this.follow ? "after" : "before",
            this.protectedIDs(),
          )
        ) {
          this.notice.textContent = "缓存预算已满，请结束选择或跳转最新后同步";
          return;
        }
        this.anchor = anchor;
        this.render();
      }
      this.revision = page.revision;
      this.nextSync =
        Date.now() +
        (document.hidden
          ? 30000
          : page.summary.active || page.summary.queue.accepted || page.more
            ? 700
            : 5000);
    } catch (e) {
      this.nextSync = Date.now() + 5000;
      if (generation === this.generation)
        this.connection.textContent =
          "连接中断，显示最后确认的记录；恢复后自动同步";
    } finally {
      if (generation === this.generation) this.syncing = false;
    }
  }
  async fragment(item, backwards = false) {
    if (this.fragments.size) return;
    this.fragments.add(item.id);
    const generation = this.generation;
    // One body fragment per logical item. Moving between fragments releases the previous one.
    const textOffset = backwards
      ? Math.max(0, item.textOffset - 4999)
      : Math.min(item.textLength, item.textOffset + item.text.length);
    const thinkingOffset = backwards
      ? Math.max(0, item.thinkingOffset - 4999)
      : Math.min(
          item.thinkingLength,
          item.thinkingOffset + (item.thinking?.length ?? 0),
        );
    try {
      const page = await this.ask({
        fragment: item.id,
        textOffset,
        thinkingOffset,
      });
      if (generation !== this.generation) return;
      const anchor = this.capture(),
        before = this.cache.before,
        after = this.cache.after;
      if (
        !this.cache.apply(
          { ...page, before, after },
          "after",
          this.protectedIDs(),
        )
      ) {
        this.notice.textContent = "正文缓存已满，请结束选择后重试";
        return;
      }
      this.anchor = anchor;
      this.render();
    } catch (e) {
      this.notice.textContent = "正文加载失败：" + e.message;
    } finally {
      if (generation === this.generation) this.fragments.delete(item.id);
    }
  }
  node(item) {
    let wrapper = this.nodes.get(item.id);
    if (!wrapper) {
      wrapper = el("div", null, "timeline-item");
      wrapper.dataset.timelineId = item.id;
      wrapper.tabIndex = -1;
      const interact = (event) => {
        if (event.target.closest("summary")) wrapper.interactedAt = Date.now();
      };
      wrapper.addEventListener("pointerdown", interact);
      wrapper.addEventListener("keydown", interact);
      wrapper.addEventListener(
        "toggle",
        () => {
          this.anchor = this.capture();
          this.schedule();
        },
        true,
      );
      this.nodes.set(item.id, wrapper);
      this.observer.observe(wrapper);
    }
    const signature = JSON.stringify(item);
    if (wrapper.signature === signature) return wrapper;
    const selection = window.getSelection();
    if (
      selection &&
      !selection.isCollapsed &&
      (wrapper.contains(selection.anchorNode) ||
        wrapper.contains(selection.focusNode))
    )
      return wrapper;
    // Preserve selection on unchanged rows and details openness across lifecycle changes.
    const open = wrapper.querySelector("details")?.open;
    wrapper.signature = signature;
    wrapper.item = item;
    wrapper.replaceChildren();
    if (item.kind === "activity") {
      const a = item.activity,
        details = el("details", null, "activity-row timeline-activity");
      details.dataset.activityId = a.id;
      details.open = open ?? false;
      const summary = el("summary"),
        label = el("span");
      summary.append(label);
      details.append(summary);
      for (const step of a.steps ?? [])
        details.append(el("p", `${step.phase} · ${step.at}`, "activity-step"));
      for (const action of a.actions ?? []) {
        const b = el(
          "button",
          {
            settings: "查看设置",
            authorization: "查看授权",
            decisions: "查看决定",
            tasks: "查看任务",
            status: "查看状态",
          }[action],
        );
        b.onclick = () => this.action(action, a);
        details.append(b);
      }
      wrapper.append(details);
      this.activityText(wrapper);
    } else {
      const article = el("article", null, `message ${item.role}`);
      article.dataset.messageId = item.call_id ?? item.id;
      article.append(
        el(
          "div",
          `${item.role === "master" ? "Master" : item.role === "secretary" ? "Secretary" : "系统"} · ${new Date(item.at).toLocaleTimeString()}`,
          "author",
        ),
      );
      if (this.preferences.thinking && item.role === "secretary") {
        const thought = el("details", null, "message-thinking");
        thought.open = open ?? true;
        thought.append(
          el("summary", "思考过程"),
          el(
            "div",
            item.thinking ||
              (item.running
                ? "等待可显示的思考内容…"
                : "本次未返回可显示的思考内容"),
            "thinking-text",
          ),
        );
        article.append(thought);
      }
      const body = el("div", null, "message-body");
      renderMarkdown(body, item.text);
      article.append(body);
      if (item.running || item.incomplete || item.truncated)
        article.append(
          el(
            "div",
            item.running
              ? "生成中"
              : item.incomplete
                ? "未完成"
                : "预览达到上限，完成后可分段阅读全文",
            "message-status",
          ),
        );
      const more =
        item.textOffset + item.text.length < item.textLength ||
        item.thinkingOffset + (item.thinking?.length ?? 0) <
          item.thinkingLength;
      if (item.textOffset || item.thinkingOffset || more) {
        const controls = el("div", null, "fragment-controls");
        controls.append(
          el(
            "span",
            `正文 ${item.textOffset + 1}–${item.textOffset + item.text.length} / ${item.textLength} 字符（分段阅读）`,
          ),
        );
        if (item.textOffset || item.thinkingOffset) {
          const b = el("button", "加载前一段");
          b.onclick = () => this.fragment(item, true);
          controls.append(b);
        }
        if (more) {
          const b = el("button", "继续加载内容");
          b.onclick = () => this.fragment(item);
          controls.append(b);
        }
        article.append(controls);
      }
      wrapper.append(article);
    }
    return wrapper;
  }
  activityText(node) {
    const a = node.item?.activity;
    if (!a) return;
    const row = node.firstChild;
    const disconnected = !!this.connection.textContent || !navigator.onLine;
    row.dataset.status =
      disconnected && a.source === "live" && !a.ended_at ? "unknown" : a.status;
    const label = row.querySelector("summary span");
    const text = ActivityView.prototype.text(
      a,
      disconnected ? (this.observedAt ?? Date.now()) : Date.now(),
    );
    if (label.textContent !== text) label.textContent = text;
  }
  updateTimes() {
    for (const node of this.nodes.values()) this.activityText(node);
  }
  schedule() {
    if (this.scheduled) return;
    this.scheduled = requestAnimationFrame(() => {
      this.scheduled = null;
      this.render();
    });
  }
  render() {
    const items = this.cache.items,
      retained = new Set(items.map((m) => m.id));
    for (const id of this.heights.keys())
      if (!retained.has(id)) this.heights.delete(id);
    const offsets = [0];
    for (const item of items)
      offsets.push(
        offsets.at(-1) +
          (this.heights.get(item.id) ?? (item.kind === "activity" ? 70 : 180)),
      );
    const anchorIndex = this.anchor
      ? items.findIndex((m) => m.id === this.anchor.id)
      : -1;
    const relative =
      anchorIndex >= 0 && !this.follow
        ? offsets[anchorIndex] - this.anchor.offset
        : this.scroller.scrollTop -
          (this.root.offsetTop - this.scroller.offsetTop);
    const height = this.scroller.clientHeight;
    let start = 0,
      end = items.length;
    if (this.follow) start = Math.max(0, items.length - 40);
    else {
      while (start < items.length && offsets[start + 1] < relative - height * 2)
        start++;
      end = start;
      while (
        end < items.length &&
        offsets[end] < relative + height * 3 &&
        end - start < 140
      )
        end++;
    }
    start = Math.min(start, Math.max(0, items.length - 1));
    end = Math.min(items.length, Math.max(start + 1, end));
    const protect = this.protectedIDs();
    for (let i = 0; i < items.length; i++)
      if (protect.has(items[i].id)) {
        start = Math.min(start, i);
        end = Math.max(end, i + 1);
      }
    if (end - start > 150) {
      this.notice.textContent = "请结束文字选择或关闭详情后继续滚动";
      return;
    }
    const wanted = new Set(items.slice(start, end).map((m) => m.id));
    for (const [id, n] of this.nodes)
      if (!wanted.has(id)) {
        this.observer.unobserve(n);
        n.remove();
        this.nodes.delete(id);
      }
    this.top.style.height = offsets[start] + "px";
    this.bottom.style.height = offsets.at(-1) - offsets[end] + "px";
    let previous = this.top;
    for (const item of items.slice(start, end)) {
      const node = this.node(item);
      if (previous.nextSibling !== node)
        this.root.insertBefore(node, previous.nextSibling);
      previous = node;
    }
    this.older.hidden = !this.cache.before;
    this.newer.hidden = !this.cache.after;
    this.latest.hidden = this.follow && !this.cache.after;
    if (this.follow) this.scroller.scrollTop = this.scroller.scrollHeight;
    else if (this.anchor && this.nodes.has(this.anchor.id)) {
      const n = this.nodes.get(this.anchor.id);
      this.scroller.scrollTop +=
        n.getBoundingClientRect().top -
        this.scroller.getBoundingClientRect().top -
        this.anchor.offset;
    }
    this.anchor = this.capture();
    document.getElementById("welcome").hidden = !!items.length;
    this.lastScrollTop = this.scroller.scrollTop;
    this.viewportWidth = this.scroller.clientWidth;
    this.viewportHeight = this.scroller.clientHeight;
    this.contentHeight = this.scroller.scrollHeight;
    this.root.dataset.cachedItems = items.length;
    this.root.dataset.cachedBytes = this.cache.bytes;
    this.root.dataset.firstId = items[0]?.id ?? "";
    this.root.dataset.lastId = items.at(-1)?.id ?? "";
    this.root.dataset.mountedItems = this.nodes.size;
    if (!this.paused && !this.pending.size) {
      if (this.scroller.scrollTop < 240 && this.cache.before)
        void this.load("before");
      else if (this.atBottom(100) && this.cache.after) void this.load("after");
    }
  }
  close() {
    this.controller.abort();
    clearInterval(this.timer);
    this.generation++;
    this.observer.disconnect();
    this.viewportObserver.disconnect();
    document.removeEventListener("selectionchange", this.onSelection);
    this.scroller.removeEventListener("scroll", this.onScroll);
    if (this.scheduled) cancelAnimationFrame(this.scheduled);
  }
}
